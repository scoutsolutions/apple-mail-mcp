# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-03-14

### Added
- **send-serial-email** - Mail merge tool: send personalized emails to multiple recipients with `{{placeholder}}` token support (max 100 recipients per batch) (PR #3 by @michaelhenze)
- **File attachments** - `send-email` and `create-draft` now accept an optional `attachments` parameter (array of absolute file paths) (PR #2 by @michaelhenze)

### Fixed
- **Locale-independent date parsing** - Dates now display correctly on non-English macOS systems (e.g., German). Previously, locale-dependent date strings could cause all emails to show the current date instead of actual received date (PR #4 by @michaelhenze)
- **Send/draft timeout resilience** - Increased timeout from 30s to 60s and enabled automatic retry with exponential backoff for `send-email` and `create-draft`, preventing failures when Mail.app is slow to establish SMTP connections

### Improved
- Attachment paths are validated (must be absolute, must exist) before sending — provides clear error messages instead of cryptic AppleScript failures
- `send-serial-email` uses `spawnSync("sleep")` instead of CPU-burning busy-wait between sends
- `send-serial-email` enforces safety limits: max 100 recipients, max 10s delay between sends

## [1.1.1] - 2026-03-10

### Fixed
- TTL cache for account and mailbox name resolution to reduce redundant AppleScript calls

## [1.1.0] - 2026-03-09

### Added
- **Batch operations** - `batch-mark-as-unread`, `batch-flag-messages`, `batch-unflag-messages`
- **Mailbox management** - `create-mailbox`, `delete-mailbox`, `rename-mailbox`
- **Mail rules** - `list-rules`, `enable-rule`, `disable-rule`
- **Contacts** - `search-contacts` (Contacts.app integration)
- **Email templates** - `save-template`, `list-template`, `get-template`, `delete-template`, `use-template`
- **save-attachment** - Download attachments to disk
- **HTML content** - `preferHtml` option in `get-message`
- Date received in search/list output
- Sender filter and pagination (`from`, `offset`) for `list-messages`
- Date range filtering (`dateFrom`, `dateTo`) for `search-messages`
- Cross-account search when no account specified
- Exposed `unflag-message` tool (was implemented but not wired up)

### Fixed
- Use Mail.app's configured default send account instead of hardcoded fallback (PR #1 by @Leewonchan14)
- Add message ID to search and list results (PR #1 by @Leewonchan14)

## [1.0.0] - 2026-01-06

First stable release with full Apple Mail integration.

### Features

#### Message Operations
- **search-messages** - Search messages by query, sender, subject with filtering options
- **list-messages** - List messages in any mailbox with pagination
- **get-message** - Retrieve full message content (subject, body, metadata)
- **send-email** - Send emails with To, CC, BCC recipients from any account
- **create-draft** - Save emails to Drafts folder without sending
- **reply-to-message** - Reply to messages with reply-all support, send or save as draft
- **forward-message** - Forward messages to new recipients with optional body
- **mark-as-read** / **mark-as-unread** - Toggle message read status
- **flag-message** / **unflag-message** - Toggle message flagged status
- **delete-message** - Move messages to Trash
- **move-message** - Organize messages into mailboxes

#### Mailbox Operations
- **list-mailboxes** - List all mailboxes/folders with unread counts
- **get-unread-count** - Get unread count for specific mailbox or all accounts

#### Account Operations
- **list-accounts** - List all configured Mail accounts

#### Diagnostics
- **health-check** - Verify Mail.app connectivity and permissions
- **get-mail-stats** - Get message and unread counts per account

### Technical
- Full AppleScript integration with proper escaping and error handling
- Retry logic with exponential backoff for transient failures
- User-friendly error messages with actionable suggestions
- Debug logging support (set DEBUG=1 or VERBOSE=1)
- 60-second timeout for message search operations
- Message ID lookup across all mailboxes for reliable operations

## [0.1.0] - 2026-01-06

Initial release - project skeleton.

### Added
- Initial project structure forked from apple-notes-mcp
- MCP server skeleton with tool definitions
- TypeScript types for Mail data models
- AppleScript utilities with error handling
