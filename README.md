# MacroAGI

MacroAGI (codename Gaia) closes the robot diffusion gap.

## Problem

Today, automation puts one robot where one person stood. This copies the inefficiencies of the old line.

## Solution

MacroAGI process-mines a full factory from CCTV and MicroAGI headset video. It rebuilds the process graph and finds the bottlenecks. Then it redesigns the full line for rented MicroAGI Atlas robots.

## Results

The reference line is a real R290 heat-pump line with 25 operations and 11 stations.

- The redesign doubles the output: 14.9 to 29.6 units/h.
- The 3-year cost is 14% lower than the "robot where a person stood" approach.

## Technologies

- **Python (uv):** a model that calculates how well each robot type can do each task. It uses a catalogue of robots that the factory can rent.
- **Google OR-Tools CP-SAT:** a solver that finds the best design for the production line.
- **SimPy:** a simulation that tests each design. It measures output, reliability and the steps to change from the old line to the new line.
- **Process mining:** a tool that finds the tasks and their order from video data.
- **TypeScript web app (Vite):** a 3D view of the factory and a 60-second animated story.

## Repository

| Folder | Function |
| --- | --- |
| `capture/` | Labels video frames with a vision model. |
| `graph/` | Builds the process graph from the labels. |
| `capability/` | Calculates robot capability for each task. |
| `optimize/` | Finds the best line designs with the solver. |
| `simulate/` | Tests each design with a simulation. |
| `story/` | Makes the data for the animated story. |
| `app/` | The web app: 3D view and story player. |
| `docs/` | The plan and the design notes. |

## Run

Install [uv](https://docs.astral.sh/uv/) and Node.js. Run the Python commands from the repository root.

1. Install the Python packages:
   ```sh
   uv sync
   ```
2. Calculate the robot capability:
   ```sh
   uv run python -m capability app/public/data/line.json
   ```
3. Find the best line designs:
   ```sh
   uv run python -m optimize app/public/data/line.json
   ```
4. Compare the designs with the simulation. This writes `results.json` (about 4 minutes):
   ```sh
   uv run python -m optimize.compare
   ```
5. Make the story data:
   ```sh
   uv run python -m story
   ```
6. Start the web app:
   ```sh
   cd app
   npm install
   npm run dev
   ```
   Open the URL that Vite shows. For the 60-second story, open `/story.html`.

The data files are already in `app/public/data/`. Thus, you can start the web app (step 6) without steps 2 to 5.

## Test

```sh
uv run pytest
cd app && npm test
```

## More information

- Full plan: `docs/MacroAGI — Technical Implementation Plan (1).md`
- Data contracts and rules: `CLAUDE.md`
