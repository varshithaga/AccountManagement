"""Bank Transaction Categorization Engine.

Implements the full flow for assigning a bank transaction to a Chart of Accounts
sub-category (Transaction.sub_category):

    0. Clean the description (clean_description()).
    1. Detect transfers between the company's own bank accounts (services.transfers).
    2. A CategoryKeyword with auto_assign=True assigns directly (a user-defined
       direct-assignment rule).
    3. An exact match with past confirmed transactions (confirmed=True) assigns
       directly, but only when every confirmed transaction with that same
       clean_description agrees on the same sub_category - a conflicting
       history falls through to scoring.
    4. Score every remaining candidate sub_category against fixed-point clues
       (keyword - from auto_assign=False CategoryKeyword rows, sub-category text,
       category text, BAI code, fuzzy history). Only the single best match per
       clue type counts; total capped at 100.
    5. Decide from the top score and the gap to the runner-up (thresholds live
       in CategorizationSettings, not hard-coded):
           score >= auto_assign_min_score and gap >= auto_assign_min_gap -> AUTO_ASSIGNED
           score >= review_min_score                                    -> NEEDS_REVIEW (sub_category
                                                                             holds the suggestion; confirmed stays False)
           otherwise                                                    -> UNCATEGORIZED
    6. When a human confirms/corrects a transaction (confirmed -> True), that
       clean_description -> sub_category becomes future Step-3 history, and is
       immediately propagated to every other unconfirmed transaction with the
       same clean_description (propagate_manual_match). create_rule_from_transaction()
       lets the caller turn that same choice into a permanent auto_assign=True
       CategoryKeyword (Step 2).

A transaction that is already confirmed (confirmed=True) or a detected
transfer (status=TRANSFER) is never touched by categorize_transactions().
"""
import re
from collections import defaultdict
from difflib import SequenceMatcher
from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..models import (
    BaiCode, CategorizationSource, CategoryKeyword, SubCategory, Transaction, TransactionStatus,
)
from .filters import TXN_NOT_TRANSFER
from .settings import categorization_settings

# Step 0 -----------------------------------------------------------------

NOISE_WORDS_RE = re.compile(r'\b(POS|ACH|NEFT|RTGS|IMPS|UPI|NACH|ECS|CHQ)\b')
HASH_REF_RE = re.compile(r'#\d+')
REFERENCE_NUMBER_RE = re.compile(r'\b\d{4,}\b')
WHITESPACE_RE = re.compile(r'\s+')
EDGE_PUNCT_RE = re.compile(r'^[\s\-.,#]+|[\s\-.,#]+$')


def clean_description(text: str) -> str:
    """Uppercase, then strip noise: hash-prefixed reference numbers ("#88321"), transaction-mode
    prefixes ("POS", "ACH", ...), and any other standalone run of 4+ digits (dates, card/reference
    numbers) - so two occurrences of the same vendor that only differ by such noise compare
    equal. Collapses whitespace and trims leftover edge punctuation."""
    text = (text or '').upper()
    text = HASH_REF_RE.sub('', text)
    text = NOISE_WORDS_RE.sub('', text)
    text = REFERENCE_NUMBER_RE.sub('', text)
    text = WHITESPACE_RE.sub(' ', text).strip()
    return EDGE_PUNCT_RE.sub('', text).strip()


# Step 4 - per-clue point weights.
KEYWORD_MAX = 70
SUBCATEGORY_TEXT_MAX = 40
CATEGORY_TEXT_MAX = 20
BAI_MAX = 60
FUZZY_HISTORY_MAX = 90


def _is_word_match(target: str, text: str) -> bool:
    """Returns True if target term exists as a word or phrase (word-bounded) in text."""
    if not target or not text:
        return False
    target_clean = target.strip().upper()
    if not target_clean:
        return False
    return bool(re.search(r'\b' + re.escape(target_clean) + r'\b', text))


def _best_by_priority_then_length(candidates):
    """candidates: iterable of (priority, matched_text, payload). Returns the
    payload with the highest priority, ties broken by the longest matched_text."""
    best = None
    best_key = None
    for priority, matched_text, payload in candidates:
        key = (priority, len(matched_text))
        if best_key is None or key > best_key:
            best_key = key
            best = payload
    return best


def _match_auto_assign_keyword(description_clean: str, keywords: list[CategoryKeyword]) -> Optional[CategoryKeyword]:
    return _best_by_priority_then_length(
        (kw.priority, kw.keyword, kw) for kw in keywords if _is_word_match(kw.keyword, description_clean)
    )


CLUE_LABEL_MAP = {
    'fuzzy_history': 'Fuzzy History Match',
    'keyword': 'Keyword Match',
    'bai_code': 'BAI Transaction Code',
    'subcategory_text': 'Sub-Category Text',
    'category_text': 'Category Text',
}


def format_scoring_clues(breakdown: Optional[dict]) -> str:
    """Comma-separated human-readable clue names from a score breakdown dict."""
    if not breakdown:
        return ''
    return ', '.join(CLUE_LABEL_MAP[k] for k in breakdown.keys() if k in CLUE_LABEL_MAP)


def _apply_direct(txn: Transaction, sub_category: SubCategory, method: CategorizationSource) -> None:
    """Steps 2 & 3: a deterministic (non-scored) direct assignment."""
    txn.sub_category_id = sub_category.id
    txn.category_id = sub_category.category_id
    txn.categorization_source = method
    txn.status = TransactionStatus.AUTO_ASSIGNED
    txn.confirmed = False
    txn.confidence_score = None
    txn.score_breakdown = None
    txn.scoring_clues = ''


def _score_accounts(description_clean, bai_code, subcategories, keywords_by_sub, bai_by_code,
                    history_descriptions_by_sub, fuzzy_min_ratio) -> dict:
    """{sub_category_id: (total_score_capped_at_100, breakdown_dict)} for every candidate with a nonzero clue."""
    bai_match = bai_by_code.get(bai_code) if bai_code else None
    results = {}

    for sub in subcategories:
        breakdown = {}

        if any(_is_word_match(kw.keyword, description_clean) for kw in keywords_by_sub.get(sub.id, ())):
            breakdown['keyword'] = KEYWORD_MAX

        sub_texts = [sub.name] + ([sub.description] if sub.description else [])
        if any(t.strip() and _is_word_match(t, description_clean) for t in sub_texts):
            breakdown['subcategory_text'] = SUBCATEGORY_TEXT_MAX

        cat_texts = [sub.category.name] + ([sub.category.description] if sub.category.description else [])
        if any(t.strip() and _is_word_match(t, description_clean) for t in cat_texts):
            breakdown['category_text'] = CATEGORY_TEXT_MAX

        if bai_match and bai_match.sub_category_id == sub.id:
            breakdown['bai_code'] = BAI_MAX

        history_descriptions = history_descriptions_by_sub.get(sub.id)
        if history_descriptions and description_clean:
            best_ratio = max(SequenceMatcher(None, description_clean, h).ratio() for h in history_descriptions) * 100
            if best_ratio >= fuzzy_min_ratio:
                breakdown['fuzzy_history'] = FUZZY_HISTORY_MAX

        if breakdown:
            results[sub.id] = (min(100, sum(breakdown.values())), breakdown)

    return results


def _promote_keyword(db: Session, description_clean: str, sub_category_id: int) -> None:
    if not description_clean:
        return
    if not db.scalar(select(CategoryKeyword.id).where(CategoryKeyword.keyword == description_clean)):
        db.add(CategoryKeyword(keyword=description_clean, sub_category_id=sub_category_id, auto_created=True))


def _is_similar_description(target: str, candidate: str, min_ratio: float = 0.70) -> bool:
    """True if candidate matches target with at least 70% similarity, or they share a
    multi-word vendor phrase."""
    if not target or not candidate:
        return False
    if target == candidate:
        return True
    if len(target.split()) >= 2 and _is_word_match(target, candidate):
        return True
    if len(candidate.split()) >= 2 and _is_word_match(candidate, target):
        return True
    return SequenceMatcher(None, target, candidate).ratio() >= min_ratio


def propagate_manual_match(db: Session, transaction: Transaction) -> int:
    """Call right after a human confirms or categorizes `transaction`. Applies the same
    category/sub_category to every OTHER unconfirmed, non-transfer transaction - on any
    statement or account - whose clean_description matches or is >=70% similar, and
    promotes a CategoryKeyword so future uploads catch this vendor directly.
    Returns how many other transactions were updated. (Does not commit.)"""
    if transaction.sub_category_id is None:
        return 0
    description_clean = transaction.clean_description or clean_description(transaction.description)
    if not description_clean:
        return 0

    candidates = db.scalars(select(Transaction).where(
        Transaction.id != transaction.id, Transaction.confirmed.is_(False), TXN_NOT_TRANSFER,
    )).all()
    updated = 0
    for t in candidates:
        t_clean = t.clean_description or clean_description(t.description)
        if not _is_similar_description(description_clean, t_clean, min_ratio=0.70):
            continue
        t.clean_description = t_clean
        t.category_id = transaction.category_id
        t.sub_category_id = transaction.sub_category_id
        t.categorization_source = CategorizationSource.HISTORY_EXACT
        t.status = TransactionStatus.AUTO_ASSIGNED
        t.confirmed = False
        t.confidence_score = (int(SequenceMatcher(None, description_clean, t_clean).ratio() * 100)
                              if t_clean != description_clean else 100)
        t.score_breakdown = {'fuzzy_history': t.confidence_score}
        t.scoring_clues = 'Fuzzy History Match'
        updated += 1

    _promote_keyword(db, description_clean, transaction.sub_category_id)
    return updated


def create_rule_from_transaction(db: Session, transaction: Transaction, priority: int = 0) -> CategoryKeyword:
    """Turns a transaction's clean_description -> sub_category into a permanent auto_assign=True
    CategoryKeyword (Step 2), so future statements assign it directly."""
    if not transaction.sub_category_id:
        raise ValueError('Transaction has no sub_category to create a rule from.')
    description_clean = transaction.clean_description or clean_description(transaction.description)
    if not description_clean:
        raise ValueError('Transaction has no usable description to create a rule from.')
    keyword = db.scalars(select(CategoryKeyword).where(CategoryKeyword.keyword == description_clean)).first()
    if keyword is None:
        keyword = CategoryKeyword(keyword=description_clean)
        db.add(keyword)
    keyword.sub_category_id = transaction.sub_category_id
    keyword.priority = priority
    keyword.is_active = True
    keyword.auto_assign = True
    db.commit()
    return keyword


def categorize_transactions(db: Session, transactions: Iterable[Transaction]) -> dict:
    """(Re)categorizes `transactions`, skipping any that is already confirmed or a detected TRANSFER."""
    settings = categorization_settings(db)

    auto_assign_keywords = db.scalars(
        select(CategoryKeyword).where(CategoryKeyword.is_active.is_(True), CategoryKeyword.auto_assign.is_(True))
        .options(joinedload(CategoryKeyword.sub_category))
    ).all()

    keywords_by_sub: dict = defaultdict(list)
    for kw in db.scalars(select(CategoryKeyword).where(CategoryKeyword.is_active.is_(True),
                                                        CategoryKeyword.auto_assign.is_(False))):
        keywords_by_sub[kw.sub_category_id].append(kw)

    subcategories = db.scalars(select(SubCategory).where(SubCategory.is_active.is_(True))
                               .options(joinedload(SubCategory.category))).all()
    sub_by_id = {sub.id: sub for sub in subcategories}

    bai_by_code = {b.code: b for b in db.scalars(select(BaiCode).where(BaiCode.sub_category_id.is_not(None)))}

    history_subs_by_description: dict = defaultdict(set)
    history_sub_by_description: dict = {}
    history_descriptions_by_sub: dict = defaultdict(list)
    for clean, sub_id in db.execute(select(Transaction.clean_description, Transaction.sub_category_id).where(
            Transaction.confirmed.is_(True), Transaction.sub_category_id.is_not(None),
            Transaction.clean_description != '')):
        history_subs_by_description[clean].add(sub_id)
        history_sub_by_description.setdefault(clean, sub_id)
        history_descriptions_by_sub[sub_id].append(clean)

    counts = {
        CategorizationSource.USER_RULE.value: 0,
        CategorizationSource.HISTORY_EXACT.value: 0,
        CategorizationSource.SCORING.value: 0,
        'NEEDS_REVIEW': 0,
        'UNCATEGORIZED': 0,
    }

    for txn in transactions:
        if txn.confirmed or txn.status == TransactionStatus.TRANSFER:
            continue  # never overwrite a human's confirmed choice or a detected transfer

        txn.clean_description = clean_description(txn.description)

        # Step 2: an auto_assign=True keyword assigns directly.
        rule_match = _match_auto_assign_keyword(txn.clean_description, auto_assign_keywords)
        if rule_match:
            _apply_direct(txn, rule_match.sub_category, CategorizationSource.USER_RULE)
            counts[CategorizationSource.USER_RULE.value] += 1
            continue

        # Step 3: exact confirmed-history match, only when unambiguous.
        subs_for_description = history_subs_by_description.get(txn.clean_description)
        if subs_for_description and len(subs_for_description) == 1:
            sub = sub_by_id.get(history_sub_by_description[txn.clean_description]) \
                or db.get(SubCategory, history_sub_by_description[txn.clean_description])
            _apply_direct(txn, sub, CategorizationSource.HISTORY_EXACT)
            counts[CategorizationSource.HISTORY_EXACT.value] += 1
            continue

        # Step 4: score every candidate account.
        scores = _score_accounts(
            txn.clean_description, txn.bai_code, subcategories, keywords_by_sub,
            bai_by_code, history_descriptions_by_sub, settings.fuzzy_match_min_ratio,
        )
        ranked = sorted(scores.items(), key=lambda kv: kv[1][0], reverse=True)
        top_sub_id, (top_score, top_breakdown) = ranked[0] if ranked else (None, (0, {}))
        second_score = ranked[1][1][0] if len(ranked) > 1 else 0

        # Step 5: decide.
        if (top_sub_id and top_score >= settings.auto_assign_min_score
                and (top_score - second_score) >= settings.auto_assign_min_gap):
            _apply_direct(txn, sub_by_id[top_sub_id], CategorizationSource.SCORING)
            txn.confidence_score = top_score
            txn.score_breakdown = top_breakdown
            txn.scoring_clues = format_scoring_clues(top_breakdown)
            counts[CategorizationSource.SCORING.value] += 1
        elif top_sub_id and top_score >= settings.review_min_score:
            # The suggestion lives directly in sub_category/category - not final until a human confirms it.
            sub = sub_by_id[top_sub_id]
            txn.sub_category_id = sub.id
            txn.category_id = sub.category_id
            txn.confidence_score = top_score
            txn.score_breakdown = top_breakdown
            txn.scoring_clues = format_scoring_clues(top_breakdown)
            txn.categorization_source = CategorizationSource.SCORING
            txn.status = TransactionStatus.NEEDS_REVIEW
            txn.confirmed = False
            counts['NEEDS_REVIEW'] += 1
        else:
            txn.category_id = None
            txn.sub_category_id = None
            txn.confidence_score = top_score if top_sub_id else None
            txn.score_breakdown = top_breakdown if top_sub_id else None
            txn.scoring_clues = format_scoring_clues(top_breakdown) if top_sub_id else ''
            txn.categorization_source = None
            txn.status = TransactionStatus.UNCATEGORIZED
            txn.confirmed = False
            counts['UNCATEGORIZED'] += 1

    db.commit()
    return counts
