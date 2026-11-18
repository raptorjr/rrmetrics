# Calendar and display preferences

This guide describes calendar and display-preference additions maintained on the `development` branch of the `raptorjr/rrmetrics` fork.

## Calendar views

The calendar provides four views:

- **Daily** — a month grid with daily P&L, trade count, win rate, and weekly summaries. Selecting a day opens its trade details, notes, and rule checks.
- **Heatmap** — a year-at-a-glance daily P&L heatmap. Selecting a day opens the same day detail panel.
- **Monthly** — a month-by-month P&L summary for the selected year.
- **Yearly** — a matrix with years as rows, January through December as columns, and a Total column.

### Yearly metrics

The Yearly view has three metric selectors:

- **P&L** — sum of the trade P&L for each month. Positive and negative months use green and red intensity respectively.
- **Win rate** — winning decisive trades divided by decisive trades, expressed as a percentage. Breakeven trades are excluded, consistent with the existing analytics calculations.
- **Trades** — number of trades in the month.

The total column aggregates the selected year's trades. Yearly win rate is weighted across all decisive trades in the year; it is not an average of the twelve monthly percentages.

Month cells show the selected metric and trade count. Selecting a month with trades switches the calendar to Daily view for that month. Empty months are not clickable.

### Date attribution

The calendar uses the existing `groupTradesByDate` helper. Trades are attributed to the date of their exit time in the existing America/New_York trading-date convention. This keeps the yearly calendar consistent with the Daily, Heatmap, and Monthly calendar views and existing market-day grouping.

## Dashboard and Analytics metric tiles

The Dashboard and Analytics pages share a metric-tile customization component.

- Show or hide supported tiles.
- Drag tiles to change their order.
- Reset each page independently to its original layout.
- Preferences are stored in browser local storage, separately for Dashboard and Analytics.
- Existing default tile sets remain in place until a user customizes a page.

Tile customization changes presentation and ordering only; it does not change the underlying calculations or trade data.

## Time display preferences

Open **Settings → Preferences**.

### Time format

Choose either 12-hour or 24-hour display. The selected format is stored in browser local storage. The default remains 12-hour for compatibility with the previous display.

### Display time zone

Choose:

- **Automatic** — use the browser's detected IANA time zone.
- **A specific time zone** — select an IANA time zone such as `Europe/Oslo`.

The preference is stored in browser local storage and affects shared trade date/time display formatting. It does not rewrite stored trade timestamps.

**Important:** Display time zone and trading-session time zone are separate. Market-day grouping and session calculations remain anchored to `America/New_York`; the preference changes how timestamps are displayed to the user, not how trades are assigned to trading days.

## Verification status

The Yearly view is present on the `development` branch and its GitHub Actions CI run passed. The view still needs interactive verification in the Babylon self-hosted installation before it should be treated as runtime-tested.
