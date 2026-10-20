"""AI Assistant: a read-only chat about the books (see services/ai_assistant.py). Each user sees only
their own chats."""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import serializers as ser
from ..config import get_settings
from ..database import COMPANY_HEADER, DEFAULT_COMPANY, get_db
from ..deps import Access
from ..errors import APIError
from ..models import AiConversation, AiMessage, User
from ..schemas import AiChatIn
from ..services import ai_assistant as ai
from ..services.settings import accounting_settings
from ..utils import today

router = APIRouter(prefix="/api/ai", tags=["ai assistant"])
# Chatting and deleting one's own chats change no books - opening the page is the only right needed.
use = Access("ai_assistant", action="read")


def _own(db: Session, user: User, conversation_id: int) -> AiConversation:
    conversation = db.get(AiConversation, conversation_id)
    if conversation is None or conversation.user_id != user.id:
        raise APIError(404, {"detail": "No such chat."})
    return conversation


def _title(question: str) -> str:
    text = re.sub(r"\s+", " ", question).strip()
    return text if len(text) <= 60 else text[:57].rstrip() + "..."


@router.get("/status/")
def status(user: User = Depends(use)):
    providers = get_settings().ai_providers
    return {"enabled": bool(providers), "providers": providers, "tools": [t.name for t in ai.tools_for(user)]}


@router.get("/conversations/")
def list_conversations(db: Session = Depends(get_db), user: User = Depends(use)):
    rows = db.scalars(select(AiConversation).where(AiConversation.user_id == user.id)
                      .order_by(AiConversation.updated_at.desc(), AiConversation.id.desc()).limit(200)).all()
    return {"results": [ser.ai_conversation(c) for c in rows]}


@router.get("/conversations/{conversation_id:int}/")
def get_conversation(conversation_id: int, db: Session = Depends(get_db), user: User = Depends(use)):
    return ser.ai_conversation(_own(db, user, conversation_id), messages=True)


@router.delete("/conversations/{conversation_id:int}/", status_code=204)
def delete_conversation(conversation_id: int, db: Session = Depends(get_db), user: User = Depends(use)):
    db.delete(_own(db, user, conversation_id))
    db.commit()
    return Response(status_code=204)


@router.post("/chat/")
async def chat(body: AiChatIn, request: Request, db: Session = Depends(get_db), user: User = Depends(use)):
    """Asks the question and saves it with the answer. Nothing is saved when no answer comes - the
    user can simply ask again."""
    question = body.message.strip()
    if not question:
        raise APIError(400, {"error": ["Type a question."]})
    conversation = _own(db, user, body.conversation) if body.conversation else None
    history = [(m.role, m.content) for m in conversation.messages] if conversation else []
    history.append(("user", question))

    settings = accounting_settings(db)
    system = ai.system_prompt(settings.company_name, settings.fiscal_year_start_month, user, today())
    db.commit()  # no transaction held open while the AI service thinks
    # The tools call this app's own endpoints as this user, in this company.
    headers = {"Authorization": request.headers.get("authorization", ""),
               COMPANY_HEADER: db.info.get("company", DEFAULT_COMPANY)}
    used: list[str] = []
    try:
        text, provider = await ai.answer(system, history, ai.tools_for(user),
                                         ai.make_tool_runner(request.app, headers, user, used), request.app)
    except ai.AssistantUnavailable as exc:
        raise APIError(503, {"detail": str(exc), "code": "ai_unavailable"})

    if conversation is None:
        conversation = AiConversation(user_id=user.id, title=_title(question))
        db.add(conversation)
    conversation.updated_at = datetime.now(timezone.utc)
    asked = AiMessage(conversation=conversation, role="user", content=question)
    answered = AiMessage(conversation=conversation, role="assistant", content=text, provider=provider, tools=used)
    db.add_all([asked, answered])
    db.commit()
    return {"conversation": ser.ai_conversation(conversation),
            "messages": [ser.ai_message(asked), ser.ai_message(answered)]}
