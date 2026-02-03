# Security Policy

## Credential Storage

thinktax stores API credentials in your config file as **plaintext**. This is a conscious trade-off for simplicity, but you should take precautions:

### Recommended Practices

1. **Set restrictive file permissions** on your config file:
   ```bash
   chmod 600 ~/.config/thinktax/config.toml        # Linux
   chmod 600 ~/Library/Application\ Support/thinktax/config.toml  # macOS
   ```

2. **Use environment variables** instead of hardcoding credentials:
   ```toml
   [cursor.team]
   apiKey = "${CURSOR_API_KEY}"
   token = "$CURSOR_TOKEN"
   ```

3. **Never commit your config file** to version control. The `.gitignore` excludes `config.toml` by default, but double-check before pushing.

4. **Use a secrets manager** for production deployments or shared machines. Export credentials as environment variables from your preferred secrets manager.

### What thinktax stores

| Data | Location | Contains Credentials? |
|------|----------|----------------------|
| Config | `~/.config/thinktax/config.toml` | Yes - API keys, tokens |
| Events | `~/.local/share/thinktax/events/` | No - only usage data |
| State | `~/.local/share/thinktax/state/` | No - only timestamps and ETags |

### Credential Types

- **Cursor Team API**: `apiKey` or `email`+`token` combination
- **Anthropic Usage API**: `adminKey` (if configured)
- **OpenAI Usage API**: `adminKey` (if configured)

## Data Privacy

thinktax processes usage data locally. No data is sent to external servers except:

1. **Cursor Team API** - When configured, fetches your team's usage data from Cursor's servers
2. **Anthropic/OpenAI Usage APIs** - When configured (not yet implemented), fetches billing data

All collected data remains on your machine in the data directory.

## Reporting Security Issues

If you discover a security vulnerability, please report it privately:

1. **Do not** open a public GitHub issue
2. Email the maintainer directly (see package.json for contact)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We aim to respond within 48 hours and will work with you to understand and address the issue.

## Security Updates

Security fixes will be released as patch versions (e.g., 0.1.1) and announced in the changelog. We recommend:

1. Watching this repository for releases
2. Keeping your installation up to date
3. Reviewing the changelog before updating

## Threat Model

thinktax is designed for individual developers tracking their own LLM usage. It is **not** designed for:

- Multi-tenant environments
- Shared workstations with untrusted users
- Production deployment without additional hardening

If you need these features, consider wrapping thinktax with additional access controls or using a dedicated secrets management solution.
