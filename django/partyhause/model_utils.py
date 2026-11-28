"""Shared model field helpers.

`uuid_str` exists because `default=str(uuid.uuid4)` is a bound-method reference
that Django's migration writer serialises as the literal string
`'<function uuid4 at 0x7f…>'`. That address differs per interpreter, so every
`makemigrations` run produced a migration that differed from the last one and
`makemigrations --check` never settled -- which is how this repo accumulated one
duplicate migration per application per generation. A module-level function
serialises as an importable path, so the generated state is stable.
"""
import uuid


def uuid_str() -> str:
    """Return a fresh UUID as a plain string, for CharField/TextField PKs."""
    return str(uuid.uuid4())