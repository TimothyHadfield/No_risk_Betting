"""
Minimal transactional email -- Python standard library only (no SDK).

Sends the optional password-reset email. Two transports, chosen by env vars:

  1. Brevo HTTP API (preferred; works on hosts like Render that BLOCK outbound
     SMTP ports). Plain HTTPS POST via urllib -- no third-party library.
       BREVO_API_KEY  -- Brevo API key                              [enables Brevo]
       BREVO_SENDER   -- a *validated* sender email in Brevo (e.g. you@gmail.com)
                         (falls back to SMTP_FROM / SMTP_USER)

  2. SMTP via smtplib (for hosts that allow outbound SMTP, e.g. local/Fly):
       SMTP_USER, SMTP_PASS  -- mailbox + app password              [enables SMTP]
       SMTP_HOST (smtp.gmail.com), SMTP_PORT (465), SMTP_FROM

  APP_NAME -- display name in the From header / subject; default "No-Risk Betting"

If neither transport is configured, is_configured() is False and the app simply
doesn't offer email reset (the recovery code still works).
"""

import json
import os
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage

APP_NAME = os.environ.get("APP_NAME", "No-Risk Betting")

# --- Brevo (HTTP API) ---
BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "").strip()

# --- SMTP (fallback) ---
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASS = (os.environ.get("SMTP_PASS", "") or "").replace(" ", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "").strip() or SMTP_USER

BREVO_SENDER = os.environ.get("BREVO_SENDER", "").strip() or SMTP_FROM


def is_configured():
    return bool(BREVO_API_KEY) or bool(SMTP_USER and SMTP_PASS)


def _send_brevo(to, subject, body):
    if not BREVO_SENDER:
        raise RuntimeError("BREVO_SENDER (a validated sender email) is not set")
    payload = json.dumps({
        "sender": {"email": BREVO_SENDER, "name": APP_NAME},
        "to": [{"email": to}],
        "subject": subject,
        "textContent": body,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email", data=payload, method="POST",
        headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json",
                 "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"Brevo {e.code}: {detail}")


def _send_smtp(to, subject, body):
    msg = EmailMessage()
    msg["From"] = f"{APP_NAME} <{SMTP_FROM}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    ctx = ssl.create_default_context()
    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=20) as s:
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            s.starttls(context=ctx)
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
    return True


def send(to, subject, body):
    """Send a plain-text email via whichever transport is configured.
    Returns True on success; raises on error."""
    if BREVO_API_KEY:
        return _send_brevo(to, subject, body)
    if SMTP_USER and SMTP_PASS:
        return _send_smtp(to, subject, body)
    return False


def send_reset_code(to, code):
    body = (
        f"Here is your {APP_NAME} password reset code:\n\n"
        f"    {code}\n\n"
        "Enter it on the \"Forgot password?\" screen to set a new password.\n"
        "It expires in 30 minutes.\n\n"
        "If you didn't request this, you can safely ignore this email."
    )
    return send(to, f"{APP_NAME} password reset code", body)
