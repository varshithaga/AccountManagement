"""Outgoing email through the SMTP server set in .env (SMTP_HOST, ...)."""
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import getaddresses

from ..config import get_settings

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
_EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


class EmailError(Exception):
    pass


def status() -> dict:
    settings = get_settings()
    return {'configured': settings.email_configured, 'from': settings.smtp_from or settings.smtp_username}


def parse_addresses(value: str, field: str, required: bool = False) -> list[str]:
    """"a@x.com, Name <b@y.com>; c@z.com" -> ["a@x.com", "b@y.com", "c@z.com"]; refuses anything malformed."""
    addresses = [addr for _, addr in getaddresses([(value or '').replace(';', ',')]) if addr]
    bad = [a for a in addresses if not _EMAIL.match(a)]
    if bad:
        raise EmailError(f'{field}: "{bad[0]}" is not an email address.')
    if required and not addresses:
        raise EmailError(f'{field}: enter at least one email address.')
    return addresses


def send(to: list[str], subject: str, body: str, cc: list[str] = (), reply_to: str = '',
         attachments: list[tuple[str, bytes, str]] = ()) -> None:
    """Sends a plain-text email. attachments: (filename, content, mime type e.g. "application/pdf")."""
    settings = get_settings()
    if not settings.email_configured:
        raise EmailError('Email is not set up on the server - add SMTP_HOST and the other SMTP_ settings to '
                         'backend/.env and restart it.')
    if not to:
        raise EmailError('Enter at least one recipient.')
    msg = EmailMessage()
    msg['From'] = settings.smtp_from or settings.smtp_username
    msg['To'] = ', '.join(to)
    if cc:
        msg['Cc'] = ', '.join(cc)
    if reply_to:
        msg['Reply-To'] = reply_to
    msg['Subject'] = (subject or '').strip() or '(no subject)'
    msg.set_content(body or '')
    for filename, content, mime in attachments:
        if len(content) > MAX_ATTACHMENT_BYTES:
            raise EmailError(f'{filename} is larger than 10 MB.')
        main, _, sub = (mime or 'application/octet-stream').partition('/')
        msg.add_attachment(content, maintype=main, subtype=sub or 'octet-stream', filename=filename)

    security = (settings.smtp_security or 'starttls').lower()
    try:
        if security == 'ssl':
            server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds,
                                      context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds)
        with server:
            if security == 'starttls':
                server.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(msg, to_addrs=[*to, *cc])
    except smtplib.SMTPAuthenticationError:
        raise EmailError('The mail server refused the SMTP username / password in backend/.env.')
    except (smtplib.SMTPException, OSError) as exc:
        raise EmailError(f'The email could not be sent: {exc}')
