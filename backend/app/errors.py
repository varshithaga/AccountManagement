"""API errors, returned in the same shapes the Django API used:
400 {"error": ["..."]} for refused actions, 400 {field: ["..."]} for invalid input,
404 / 403 {"detail": "..."}."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class APIError(Exception):
    def __init__(self, status_code: int, payload):
        self.status_code = status_code
        self.payload = payload


def bad_request(*messages: str) -> APIError:
    return APIError(400, {"error": list(messages)})


def field_error(field: str, message: str) -> APIError:
    return APIError(400, {field: [message]})


def not_found(detail: str = "Not found.") -> APIError:
    return APIError(404, {"detail": detail})


def forbidden(detail: str) -> APIError:
    return APIError(403, {"detail": detail})


def conflict(payload) -> APIError:
    return APIError(409, payload)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api_error(_request: Request, exc: APIError):
        return JSONResponse(status_code=exc.status_code, content=exc.payload)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError):
        errors: dict[str, list[str]] = {}
        for err in exc.errors():
            loc = [str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path", "form")]
            field = ".".join(loc) or "non_field_errors"
            msg = err.get("msg", "Invalid value.")
            errors.setdefault(field, []).append(msg.removeprefix("Value error, "))
        return JSONResponse(status_code=400, content=errors)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail},
                            headers=getattr(exc, "headers", None))
