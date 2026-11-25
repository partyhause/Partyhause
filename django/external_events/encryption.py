"""Encryption helpers for external event provider credentials.

Uses Fernet (AES-128-CBC + HMAC-SHA256) via the ``cryptography`` package.
The key is read from ``EXTERNAL_EVENTS_ENCRYPTION_KEY``; generate one with::

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If no key is configured, credentials are stored in plaintext and a warning is
emitted once per process — acceptable only for local development.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_cipher: Optional[Fernet] = None
_cipher_lock = threading.Lock()
_warned_no_key = False


def _get_cipher() -> Optional[Fernet]:
    """Lazily build the Fernet cipher from the env key."""
    global _cipher, _warned_no_key
    if _cipher is not None:
        return _cipher
    with _cipher_lock:
        if _cipher is not None:
            return _cipher
        key = os.environ.get('EXTERNAL_EVENTS_ENCRYPTION_KEY', '').strip()
        if not key:
            if not _warned_no_key:
                logger.warning(
                    'EXTERNAL_EVENTS_ENCRYPTION_KEY not set; external provider '
                    'credentials will be stored in plaintext. Generate one with: '
                    'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
                )
                _warned_no_key = True
            return None
        _cipher = Fernet(key.encode())
        return _cipher


def encrypt_value(plaintext: Optional[str]) -> Optional[bytes]:
    """Encrypt a string. Returns None for None/empty input."""
    if plaintext is None or plaintext == '':
        return None
    cipher = _get_cipher()
    if cipher is None:
        # No key configured: store plaintext (dev only).
        return plaintext.encode()
    return cipher.encrypt(plaintext.encode())


def decrypt_value(ciphertext: Optional[bytes]) -> Optional[str]:
    """Decrypt bytes back to a string. Handles legacy plaintext (str bytes)."""
    if ciphertext is None:
        return None
    if isinstance(ciphertext, str):
        ciphertext = ciphertext.encode()
    cipher = _get_cipher()
    if cipher is None:
        # Legacy plaintext stored when no key was configured.
        return ciphertext.decode()
    try:
        return cipher.decrypt(ciphertext).decode()
    except InvalidToken:
        # Fall back to treating as legacy plaintext.
        return ciphertext.decode()
