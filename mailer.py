"""
Minimal transactional email via SMTP -- Python standard library only (smtplib).

No third-party SDK/service: this relays through an ordinary mailbox (e.g. Gmail)
configured entirely by environment variables. Used solely for the optional
email-based password reset. If SMTP isn't configured, is_configured() returns
False and the app simply doesn't offer email reset (the recovery code still works).

Env vars:
  SMTP_USER  -- the sending account (e.g. you@gmail.com)         [required to send]
  SMTP_PASS  -- an app password for that account                 [required to send]
  SMTP_HOST  -- default "smtp.gmail.com"
  SMTP_PORT  -- default 465 (implicit SSL); use 587 for STARTTLS
  SMTP_FROM  -- From address; defaults to SMTP_USER
  APP_NAME   -- display name in the From header / subject; default "No-Risk Betting"
"""

import os
import smtplib
import ssl
from email.message import EmailMessage

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
# App passwords are often shown with spaces -- tolerate that.
SMTP_PASS = (os.environ.get("SMTP_PASS", "") or "").replace(" ", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "").strip() or SMTP_USER
APP_NAME = os.environ.get("APP_NAME", "No-Risk Betting")


def is_configured():
    return bool(SMTP_USER and SMTP_PASS)


def send(to, subject, body):
    """Send a plain-text email. Returns True on success; raises on SMTP error."""
    if not is_configured():
        return False
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


def send_reset_code(to, code):
    body = (
        f"Here is your {APP_NAME} password reset code:\n\n"
        f"    {code}\n\n"
        "Enter it on the \"Forgot password?\" screen to set a new password.\n"
        "It expires in 30 minutes.\n\n"
        "If you didn't request this, you can safely ignore this email."
    )
    return send(to, f"{APP_NAME} password reset code", body)
