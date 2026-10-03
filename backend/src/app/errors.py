"""Application error hierarchy.

Services raise subclasses of ``AppError``; ``main.py`` converts them into JSON
responses of the form ``{"detail": ...}`` with ``status_code``. Routers therefore
never need ``try/except`` blocks for expected failures.

The message is Japanese and shown to the user as is. The original text from the system
(exception message, upstream API response) goes into ``raw_response``; the frontend shows
it below the message in the error toast (docs/specs/notifications.md).
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

UNEXPECTED_ERROR_MESSAGE = "バックエンドで予期しないエラーが発生しました。"


class AppError(Exception):
    """Base class for errors that map to an HTTP response."""

    status_code: int = 500

    def __init__(self, message: str, *, raw_response: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.raw_response = raw_response

    @property
    def detail(self) -> Any:
        """Body of the ``detail`` field. Includes the original system text when present."""
        if self.raw_response:
            return {"message": self.message, "raw_response": self.raw_response}
        return self.message


class BadRequestError(AppError):
    status_code = 400


class NotFoundError(AppError):
    status_code = 404


def exception_text(e: BaseException) -> str:
    """``"<type>: <message>"`` — the original text of an exception for ``raw_response``."""
    return f"{type(e).__name__}: {e}"


@contextmanager
def unexpected_errors_as(message: str) -> Iterator[None]:
    """Wraps non-``AppError`` exceptions as a 500 ``AppError`` with ``message`` (original text in raw_response)."""
    try:
        yield
    except AppError:
        raise
    except Exception as e:
        raise AppError(message, raw_response=exception_text(e)) from e
