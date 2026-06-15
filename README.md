# github-project-reporter

Generates a daily report of items in a GitHub [ProjectV2](https://docs.github.com/en/issues/planning-and-tracking-with-projects), printing each issue together with its project field values (status, iteration, etc.).

## Setup

```bash
npm install
cp .env.example .env   # then fill in GH_TOKEN and PROJECT_ID
```

| Variable     | Description                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| `GH_TOKEN`   | GitHub token with project read access (`read:project` + `repo`).            |
| `PROJECT_ID` | Node ID of the ProjectV2 (starts with `PVT_`).                              |

To find your `PROJECT_ID`:

```bash
gh api graphql -f query='{ viewer { projectV2(number: 1) { id } } }'
```

## Usage

```bash
# load the .env and run
export $(grep -v '^#' .env | xargs) && npm run report
```

or pass the variables inline:

```bash
GH_TOKEN=... PROJECT_ID=... npm run report
```
