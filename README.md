# Docmost MCP Server

A Model Context Protocol (MCP) server for [Docmost](https://docmost.com/), enabling AI agents to search, create, modify, and organize documentation pages and spaces.

## Features

### Core Management

- **`create_page`**: Smart creation tool. Creates content (via import) AND handles hierarchy (nesting under a parent) in one go.
- **`update_page`**: Update a page's content and/or title. Updates are performed via real-time collaboration (WebSocket).
- **`delete_page` / `delete_pages`**: Delete single or multiple pages at once.
- **`move_page`**: Organize pages hierarchically by moving them to a new parent or root.

### Exploration & Retrieval

- **`search`**: Full-text search across spaces with optional space filtering (`query`, `spaceId`).
- **`get_workspace`**: Get information about the current Docmost workspace.
- **`list_spaces`**: View all spaces within the current workspace.
- **`list_groups`**: View all groups within the current workspace.
- **`list_pages`**: List pages within a space (ordered by `updatedAt` descending).
- **`get_page`**: Retrieve full content and metadata of a specific page.

### Technical Details

- **Automatic Markdown Conversion**: Page content is automatically converted from Docmost's internal ProseMirror/TipTap JSON format to clean Markdown for easy agent consumption. Supports all Docmost extensions including callouts, task lists, math blocks, embeds, and more.
- **Smart Import API**: Uses Docmost's import API to ensure clean Markdown-to-ProseMirror conversion when creating pages.
- **Child Preservation**: The `update_page` tool creates a new page ID but effectively simulates an in-place update by reparenting existing child pages to the new version.
- **Pagination Support**: Automatically handles pagination for large datasets (spaces, pages, groups).
- **Filtered Responses**: API responses are filtered to include only relevant information, optimizing data transfer for agents.

## Installation

```bash
npm install
npm run build
```

## Configuration

This server requires the following environment variables to be set:

- `DOCMOST_API_URL`: The full URL to your Docmost API (e.g., `https://docs.example.com/api`).
- `DOCMOST_EMAIL`: The email address for authentication.
- `DOCMOST_PASSWORD`: The password for authentication.

## usage with Claude Desktop / generic MCP Client

Add the following to your MCP configuration (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "docmost-local": {
      "command": "node",
      "args": ["./build/index.js"],
      "env": {
        "DOCMOST_API_URL": "http://localhost:3000/api",
        "DOCMOST_EMAIL": "test@docmost.com",
        "DOCMOST_PASSWORD": "test"
      }
    }
  }
}
```

## Development

```bash
# Watch mode
npm run watch

# Build
npm run build
```

## License

MIT
