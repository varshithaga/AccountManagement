"""First-run setup (default roles) and optional starter data."""
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..access import DEFAULT_ROLES
from ..models import BaiCode, BankAccount, Category, CategoryKeyword, Role, SubCategory, TaxRate
from .. import seed_data


def ensure_default_roles(db: Session) -> None:
    """Creates the starter roles that don't exist yet (never changes existing ones)."""
    existing = set(db.scalars(select(Role.name)).all())
    for name, description, admin, pages, actions in DEFAULT_ROLES:
        if name not in existing:
            db.add(Role(name=name, description=description, is_admin=admin, pages=pages, actions=actions))
    db.commit()


def seed_bai_codes(db: Session) -> dict:
    """Adds the standard BAI codes; maps a code to its default category only when it has none yet."""
    created = updated = mapped = 0
    categories = {c.name: c for c in db.scalars(select(Category))}
    for code, description, category_name, sub_category_name in seed_data.BAI_CODES:
        bai = db.scalars(select(BaiCode).where(BaiCode.code == code)).first()
        if bai is None:
            bai = BaiCode(code=code, description=description)
            db.add(bai)
            created += 1
        else:
            bai.description = description
            updated += 1
        if bai.category_id is None and category_name and category_name in categories:
            category = categories[category_name]
            bai.category_id = category.id
            if sub_category_name:
                sub = db.scalars(select(SubCategory).where(SubCategory.category_id == category.id,
                                                           SubCategory.name == sub_category_name)).first()
                if sub:
                    bai.sub_category_id = sub.id
            mapped += 1
    db.commit()
    return {'created': created, 'updated': updated, 'mapped': mapped}


def seed_chart_of_accounts(db: Session) -> dict:
    """Adds the starter Chart of Accounts, keyword rules, GST rates and sample bank accounts.
    Only adds what is missing - existing accounts are left alone."""
    subs = {}
    for account_type, categories in seed_data.CHART_OF_ACCOUNTS.items():
        for category_name, sub_names in categories.items():
            category = db.scalars(select(Category).where(Category.name == category_name,
                                                         Category.account_type == account_type)).first()
            if category is None:
                category = Category(name=category_name, account_type=account_type)
                db.add(category)
                db.flush()
            for sub_name in sub_names:
                sub = db.scalars(select(SubCategory).where(SubCategory.category_id == category.id,
                                                           SubCategory.name == sub_name)).first()
                if sub is None:
                    sub = SubCategory(category_id=category.id, name=sub_name)
                    db.add(sub)
                    db.flush()
                subs[(category_name, sub_name)] = sub

    for keyword, category_name, sub_name in seed_data.KEYWORDS:
        sub = subs.get((category_name, sub_name))
        if sub and not db.scalar(select(CategoryKeyword.id).where(CategoryKeyword.keyword == keyword)):
            db.add(CategoryKeyword(keyword=keyword, sub_category_id=sub.id))

    by_name = {s.name: s for s in subs.values()}
    for name, rate, output_name, input_name in seed_data.TAX_RATES:
        if not db.scalar(select(TaxRate.id).where(TaxRate.name == name)):
            db.add(TaxRate(name=name, rate=Decimal(rate),
                           output_tax_account_id=by_name[output_name].id if output_name in by_name else None,
                           input_tax_account_id=by_name[input_name].id if input_name in by_name else None))

    for name, bank_name, account_number in seed_data.SAMPLE_BANK_ACCOUNTS:
        if not db.scalar(select(BankAccount.id).where(BankAccount.name == name)):
            db.add(BankAccount(name=name, bank_name=bank_name, account_number=account_number))
    db.commit()
    return {
        'categories': db.scalar(select(func.count(Category.id))),
        'sub_categories': db.scalar(select(func.count(SubCategory.id))),
        'keywords': db.scalar(select(func.count(CategoryKeyword.id))),
        'tax_rates': db.scalar(select(func.count(TaxRate.id))),
        'bank_accounts': db.scalar(select(func.count(BankAccount.id))),
    }
