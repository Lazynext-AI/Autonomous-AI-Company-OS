# Autonomous AI Company Dashboard

A comprehensive, real-time dashboard for monitoring your autonomous AI company. Data refreshes automatically - no need to check the database or console logs.

## Features

### 🎯 Live Updates
- **Polling**: Data refreshes every 1-2 seconds via `/api/query` (server-side proxy to the Cloudflare Worker)
- **Visual Indicators**: Live status indicators show when data is updating

### 📊 Overview Page (`/`)
- **Key Metrics**: Users, MRR, Uptime, Deployments
- **Task Status**: Pending, In Progress, Completed, Failed counts
- **Active Agents**: Real-time agent status and activity
- **Recent Tasks**: Latest 10 tasks with full details
- **System Health**: Quick view of overall system status

### 👥 Agents Page (`/agents`)
- **Agent Cards**: Individual status for each agent
- **Performance Scores**: Color-coded performance metrics
- **Task Statistics**: Completed vs Failed tasks per agent
- **Success Rates**: Calculated success percentages
- **Current Tasks**: What each agent is working on right now
- **Last Active**: Timestamp of last activity

### 📡 Live Feed Page (`/feed`)
- **Real-Time Task Stream**: All tasks as they happen
- **Status Filtering**: Filter by pending, in_progress, completed, failed
- **Task Details**: Full descriptions, results, error logs
- **Performance Scores**: Task performance metrics
- **Time Stamps**: Relative time ("2m ago") and absolute times
- **Auto-Scroll**: New tasks appear at the top

### 🧠 Company Brain Page (`/brain`)
- **Product Info**: Name, mission, description
- **Metrics Dashboard**: All key metrics in one place
- **Tech Stack**: Current technology stack
- **Shipped Features**: List of completed features
- **Open Bugs**: Current bugs with severity
- **Blockers**: Technical blockers preventing progress
- **User Feedback**: Customer feedback and insights

## Setup

### 1. Environment Variables

Create a `.env.local` file in the dashboard directory (server-side only, never exposed to the browser):

```bash
CLOUDFLARE_API_URL=https://ai-company-os.<your-account>.workers.dev
CLOUDFLARE_API_TOKEN=your_shared_worker_secret
```

### 2. Install Dependencies

```bash
cd dashboard
npm install
```

### 3. Run Development Server

```bash
npm run dev
```

The dashboard will be available at `http://localhost:3000`

## Real-Time Features

### Worker API Proxy
- `/api/query` Next.js route proxies SQL queries to the Cloudflare Worker
- The Worker token stays server-side (never shipped to the browser)

### Polling
- 1-2 second intervals for critical data
- Ensures updates without realtime subscriptions

### Visual Feedback
- Live indicator (pulsing green dot)
- Last update timestamp
- Loading states
- Error handling

## Data Sources

### Company Brain (`company_brain` table)
- Product information
- Metrics (users, revenue, MRR, uptime)
- Tech stack
- Shipped features
- Open bugs
- Blockers
- Agent statuses

### Task Log (`task_log` table)
- All tasks with status
- Task descriptions
- Results and outputs
- Error logs
- Performance scores
- Timestamps

### Agent Memories (`agent_memories` table)
- Agent performance scores
- Tasks completed/failed
- Current tasks
- Retry counts
- Last active timestamps

## Navigation

- **Overview** (`/`): Main dashboard with key metrics
- **Agents** (`/agents`): Detailed agent status
- **Live Feed** (`/feed`): Real-time task stream
- **Company Brain** (`/brain`): Full company state

## Styling

- **Dark Theme**: Zinc color palette for easy viewing
- **Responsive**: Works on desktop, tablet, and mobile
- **Smooth Animations**: Transitions and loading states
- **Custom Scrollbars**: Styled for dark theme

## Performance

- **Efficient Queries**: Only fetches necessary data
- **Optimized Rendering**: React optimizations
- **Cached Subscriptions**: Reuses connections
- **Debounced Updates**: Prevents excessive re-renders

## Troubleshooting

### No Data Showing
1. Check `CLOUDFLARE_API_URL` / `CLOUDFLARE_API_TOKEN` are set in `.env.local`
2. Verify the Worker is deployed and the D1 schema was applied (`make worker-migrate`)
3. Check browser console and the Network tab for `/api/query` responses
4. Confirm the agents are running and writing to D1

### Updates Not Refreshing
1. Polling runs every 1-2 seconds; check `/api/query` in the Network tab
2. Verify the Worker `/health` endpoint returns 200

### Styling Issues
1. Ensure Tailwind CSS is compiled
2. Check `globals.css` is imported
3. Verify dark mode classes are applied

## Future Enhancements

- [ ] WebSocket support for even faster updates
- [ ] Charts and graphs for metrics over time
- [ ] Export functionality for reports
- [ ] Customizable dashboard layouts
- [ ] Alert notifications
- [ ] Search and filtering
- [ ] Agent performance trends
- [ ] Code change diffs
- [ ] Deployment history
