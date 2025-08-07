# Security Policy

## ⚠️ ARCHIVED PROJECT

**This project is archived and no longer maintained.** Security vulnerabilities will not be addressed or patched. Use this code at your own risk and only for reference purposes.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| All     | ❌ Not Supported   |

## Reporting a Vulnerability

**Security reports are not being accepted** as this project is archived and provided for reference only. Any identified vulnerabilities will not be addressed.


## Security Features

Fluxor implements the following security measures:

- **Authentication**: JWT-based authentication with refresh token rotation
- **Password Security**: Bcrypt hashing with appropriate salt rounds
- **Input Validation**: Joi schemas for all API inputs
- **SQL Injection Prevention**: Parameterized queries throughout
- **XSS Protection**: React's built-in escaping and Content Security Policy headers
- **CSRF Protection**: Token-based CSRF protection
- **Rate Limiting**: API rate limiting to prevent abuse
- **Security Headers**: Helmet.js for security headers
- **HTTPS**: Enforced in production environments
- **Audit Logging**: Critical actions are logged for security monitoring

