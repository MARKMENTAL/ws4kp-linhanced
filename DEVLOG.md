## Server Observations

Added a new `Server Observations` forecast screen that blends Linux server telemetry into the WeatherStar rotation using `fastfetch`.

- added `/api/server-info` to run `fastfetch` and return a cleaned plain-text summary
- created a new `serverobservations` display module and EJS partial
- registered the new screen in the main display deck and script loading flow
- paginated the server info across multiple readable screens instead of trying to force a single page
- adjusted styling to better fit the blue content box and reduced the header title size for this screen
- reduced text sizing and enabled wrapping for long kernel/CPU lines so the content fits inside the display box
- added the screen to the initial progress display list and tightened the progress screen typography so the extra row fits cleanly
- updated navigation handling to safely work with sparse display arrays introduced by the new nav slot
- updated the frontend build so generated CSS is copied to the development-served stylesheet path as well
