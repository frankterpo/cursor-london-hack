import { createServer, IncomingMessage, ServerResponse } from "http";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { config } from "dotenv";
import { fetchPrsForRepo } from "./repoProcessor.js";

config();

const PORT = 3001;
const ROOT = process.cwd();

// Simple router
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // List all accessible repos
    if (url.pathname === "/api/repos" && req.method === "GET") {
      const repos = await listGitHubRepos();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(repos));
      return;
    }

    // Get current tweets data
    if (url.pathname === "/api/tweets" && req.method === "GET") {
      try {
        const data = await readFile(join(ROOT, "x-posts-data.json"), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ generated: null, totalPosts: 0, prs: [] }));
      }
      return;
    }

    // Populate tweets for a specific repo (with SSE streaming)
    if (url.pathname === "/api/populate" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const { repo } = JSON.parse(body);
          console.log(`\n🚀 Populating tweets for ${repo}...`);
          
          // Set up SSE headers
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });

          const sendEvent = (data: any) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
          };

          try {
            const result = await fetchPrsForRepo(repo, (event) => {
              sendEvent(event);
            });
            
            sendEvent({ type: 'done', result });
            res.end();
          } catch (error: any) {
            sendEvent({ type: 'error', error: error.message });
            res.end();
          }
        } catch (error: any) {
          console.error("Populate error:", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return;
    }

    // Serve static files
    if (url.pathname === "/" || url.pathname === "/dashboard") {
      const html = await readFile(join(ROOT, "dashboard.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    if (url.pathname === "/x-posts-data.json") {
      try {
        const data = await readFile(join(ROOT, "x-posts-data.json"), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ generated: null, totalPosts: 0, prs: [] }));
      }
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    
  } catch (error: any) {
    console.error("Server error:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function listGitHubRepos(): Promise<any[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");

  const repos: any[] = [];
  let page = 1;
  
  while (true) {
    const response = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `token ${token}`,
          "User-Agent": "tweet-generator",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const data = await response.json();
    if (data.length === 0) break;
    
    repos.push(...data.map((r: any) => ({
      fullName: r.full_name,
      name: r.name,
      owner: r.owner.login,
      description: r.description,
      private: r.private,
      updatedAt: r.updated_at,
      defaultBranch: r.default_branch,
      openIssues: r.open_issues_count,
      language: r.language,
      htmlUrl: r.html_url,
    })));
    
    page++;
  }

  return repos;
}

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
🐦 Tweet Generator Server
─────────────────────────
Dashboard: http://localhost:${PORT}
API:       http://localhost:${PORT}/api/repos
           http://localhost:${PORT}/api/tweets
           http://localhost:${PORT}/api/populate

Press Ctrl+C to stop
  `);
});

