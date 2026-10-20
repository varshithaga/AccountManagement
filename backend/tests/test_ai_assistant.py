"""AI Assistant: Gemini first, OpenAI as the fallback, tools that only read through the user's own access,
and chats kept per user. No real AI service is called - PROVIDER_TRANSPORT answers instead."""
import json

import httpx
import pytest

from app.config import get_settings
from app.services import ai_assistant as ai


class FakeAI:
    """Plays the AI services: each request gets the next scripted reply; the requests are kept."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        status, body = self.replies.pop(0)
        return httpx.Response(status, json=body)

    def body(self, i: int) -> dict:
        return json.loads(self.requests[i].content)


def gemini_text(text):
    return 200, {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}, "finishReason": "STOP"}]}


def gemini_call(name, args):
    return 200, {"candidates": [{"content": {"role": "model", "parts": [
        {"functionCall": {"name": name, "args": args}, "thoughtSignature": "sig-1"}]}}]}


def openai_text(text):
    return 200, {"choices": [{"message": {"role": "assistant", "content": text}}]}


def openai_call(name, args):
    return 200, {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [
        {"id": "call_1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}}]}


@pytest.fixture()
def keys(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "gemini_api_key", "gemini-test-key")
    monkeypatch.setattr(settings, "openai_api_key", "openai-test-key")


@pytest.fixture()
def fake(monkeypatch):
    def install(*replies):
        fake_ai = FakeAI(*replies)
        monkeypatch.setattr(ai, "PROVIDER_TRANSPORT", httpx.MockTransport(fake_ai))
        return fake_ai
    return install


def test_off_without_keys(admin, monkeypatch, fake):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    monkeypatch.setattr(get_settings(), "openai_api_key", "")
    fake_ai = fake()
    assert admin.get("/api/ai/status/").json()["enabled"] is False
    r = admin.post("/api/ai/chat/", json={"message": "What is my profit?"})
    assert r.status_code == 503 and "GEMINI_API_KEY" in r.json()["detail"]
    assert fake_ai.requests == []
    assert admin.get("/api/ai/conversations/").json()["results"] == []  # nothing saved


def test_gemini_answers_with_a_report(admin, keys, fake):
    fake_ai = fake(gemini_call("profit_and_loss", {"period": "this_month"}), gemini_text("Net profit is Rs 0."))
    r = admin.post("/api/ai/chat/", json={"message": "What is my profit this month?"})
    assert r.status_code == 200, r.text
    data = r.json()
    answer = data["messages"][1]
    assert answer["content"] == "Net profit is Rs 0." and answer["provider"] == "gemini"
    assert answer["tools"] == ["profit_and_loss"]
    assert data["conversation"]["title"] == "What is my profit this month?"

    first, second = fake_ai.body(0), fake_ai.body(1)
    assert fake_ai.requests[0].headers["x-goog-api-key"] == "gemini-test-key"
    assert "profit_and_loss" in [d["name"] for d in first["tools"][0]["functionDeclarations"]]
    # The model's own turn goes back unchanged (thought signature included), then the report itself.
    assert second["contents"][-2]["parts"][0]["thoughtSignature"] == "sig-1"
    result = json.loads(second["contents"][-1]["parts"][0]["functionResponse"]["response"]["result"])
    assert result["period"] == "this_month" and "net_profit" in result


def test_falls_back_to_openai(admin, keys, fake):
    fake_ai = fake((429, {"error": {"message": "quota"}}),
                   openai_call("list_sales_invoices", {"overdue": True, "limit": 500}),
                   openai_text("No overdue invoices."))
    r = admin.post("/api/ai/chat/", json={"message": "Which invoices are overdue?"})
    assert r.status_code == 200, r.text
    answer = r.json()["messages"][1]
    assert answer["provider"] == "openai" and answer["tools"] == ["list_sales_invoices"]
    assert fake_ai.requests[1].headers["authorization"] == "Bearer openai-test-key"
    tool_reply = fake_ai.body(2)["messages"][-1]
    assert tool_reply["role"] == "tool" and tool_reply["tool_call_id"] == "call_1"
    assert json.loads(tool_reply["content"])["count"] == 0


def test_both_fail_saves_nothing(admin, keys, fake):
    fake((500, {}), (500, {}))
    r = admin.post("/api/ai/chat/", json={"message": "Hello"})
    assert r.status_code == 503 and r.json()["code"] == "ai_unavailable"
    assert admin.get("/api/ai/conversations/").json()["results"] == []


def test_tool_query_is_limited():
    tool = ai.TOOLS_BY_NAME["list_sales_invoices"]
    assert ai._query(tool, {"limit": 500, "overdue": True, "unknown": "x", "status": None}) == \
        {"limit": "50", "overdue": "true"}
    pnl = ai.TOOLS_BY_NAME["profit_and_loss"]
    assert ai._query(pnl, {"period": "this_year", "date_from": "2026-04-01", "date_to": "2026-06-30"}) == \
        {"period": "custom", "date_from": "2026-04-01", "date_to": "2026-06-30"}
    assert len(ai.result_text({"rows": list(range(100))})) < 400  # long lists are cut


def _user_with_role(admin, username, pages):
    admin.post("/api/auth/register/", json={"username": username, "password": "Another-pass1"})
    role = admin.post("/api/roles/", json={"name": f"{username} role", "pages": pages})
    assert role.status_code == 201, role.text
    user = next(u for u in admin.get("/api/users/").json()["results"] if u["username"] == username)
    assert admin.patch(f"/api/users/{user['id']}/", json={"role": role.json()["id"]}).status_code == 200
    token = admin.post("/api/auth/token/", json={"username": username, "password": "Another-pass1"}).json()["access"]
    return {"Authorization": f"Bearer {token}"}


def test_access_follows_the_role(admin, keys, fake):
    viewer = next(r for r in admin.get("/api/roles/").json() if r["name"] == "Viewer")
    assert "ai_assistant" not in viewer["pages"]
    no_ai = _user_with_role(admin, "clerk", ["profit_and_loss"])
    assert admin.post("/api/ai/chat/", json={"message": "Hi"}, headers=no_ai).status_code == 403

    # Allowed the assistant and P&L only: no invoice tool is offered, and one asked for anyway is refused.
    reports = _user_with_role(admin, "analyst", ["ai_assistant", "profit_and_loss"])
    tools = admin.get("/api/ai/status/", headers=reports).json()["tools"]
    assert "profit_and_loss" in tools and "list_sales_invoices" not in tools
    fake_ai = fake(gemini_call("list_sales_invoices", {}), gemini_text("I can't see invoices."))
    r = admin.post("/api/ai/chat/", json={"message": "List invoices"}, headers=reports)
    assert r.status_code == 200, r.text
    result = fake_ai.body(1)["contents"][-1]["parts"][0]["functionResponse"]["response"]["result"]
    assert "no tool" in result
    assert r.json()["messages"][1]["tools"] == []


def test_chats_are_kept_per_user(admin, keys, fake):
    fake_ai = fake(gemini_text("First answer."), gemini_text("Second answer."))
    first = admin.post("/api/ai/chat/", json={"message": "First question"}).json()
    chat_id = first["conversation"]["id"]
    r = admin.post("/api/ai/chat/", json={"message": "Second question", "conversation": chat_id})
    assert r.status_code == 200 and r.json()["conversation"]["id"] == chat_id
    # The earlier turns went along with the new question.
    assert [c["parts"][0]["text"] for c in fake_ai.body(1)["contents"]] == \
        ["First question", "First answer.", "Second question"]
    saved = admin.get(f"/api/ai/conversations/{chat_id}/").json()
    assert [m["content"] for m in saved["messages"]] == \
        ["First question", "First answer.", "Second question", "Second answer."]

    other = _user_with_role(admin, "colleague", ["ai_assistant"])
    assert admin.get("/api/ai/conversations/", headers=other).json()["results"] == []
    assert admin.get(f"/api/ai/conversations/{chat_id}/", headers=other).status_code == 404
    assert admin.delete(f"/api/ai/conversations/{chat_id}/", headers=other).status_code == 404
    assert admin.post("/api/ai/chat/", json={"message": "x", "conversation": chat_id}, headers=other).status_code == 404

    assert admin.delete(f"/api/ai/conversations/{chat_id}/").status_code == 204
    assert admin.get("/api/ai/conversations/").json()["results"] == []
