"""Application error hierarchy.

Services raise subclasses of ``AppError``; ``main.py`` converts them into JSON
responses of the form ``{"detail": ...}`` with ``status_code``. Routers therefore
never need ``try/except`` blocks for expected failures.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any


class AppError(Exception):
    """Base class for errors that map to an HTTP response."""

    status_code: int = 500

    def __init__(self, message: str, *, raw_response: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.raw_response = raw_response

    @property
    def detail(self) -> Any:
        """Body of the ``detail`` field. Includes the upstream API response when present."""
        if self.raw_response:
            return {"message": self.message, "raw_response": self.raw_response}
        return self.message


class BadRequestError(AppError):
    status_code = 400


class NotFoundError(AppError):
    status_code = 404


@contextmanager
def unexpected_errors_as(prefix: str) -> Iterator[None]:
    """Wraps non-``AppError`` exceptions as a 500 ``AppError`` whose message starts with ``prefix``."""
    try:
        yield
    except AppError:
        raise
    except Exception as e:
        raise AppError(f"{prefix}: {e}") from e
