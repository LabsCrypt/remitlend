# Security Policy

## Supported Versions

Security reports should target the current `main` branch and the latest tagged
release. Older tags are not actively maintained unless a maintainer explicitly
states otherwise in the release notes.

## Reporting a Vulnerability

Please report suspected vulnerabilities privately before opening a public issue.
Include the affected component, impact, reproduction steps, and any relevant
transaction IDs or logs.

Primary reporting channel:

- Open a private security advisory on GitHub if available.

Fallback channel:

- Contact the maintainers through the contributor Telegram linked from current
  Stellar Wave issues, and ask for a private disclosure channel before sharing
  exploit details.

Do not post working exploits, private keys, seed phrases, or user data in a
public issue, pull request, or chat.

## Response Timeline

The maintainers aim to acknowledge valid reports within 5 business days. For
confirmed issues, we use a 90-day coordinated disclosure window unless active
exploitation or user risk requires a faster public fix.

## Scope

In scope:

- Smart contracts under `contracts/`
- Backend services under `backend/`
- Frontend code under `frontend/`
- Repository deployment and configuration files

Out of scope:

- Third-party services, wallets, RPC providers, and infrastructure not owned by
  this repository
- Social engineering, phishing, spam, or physical attacks
- Denial-of-service testing that degrades public services
- Reports that require access to private keys, seed phrases, or user data

## Rewards

RemitLend does not operate a standing paid security bounty program unless a
specific issue, campaign, or maintainer announcement says otherwise. Reward
eligibility, if any, is defined by the linked issue or external program.
