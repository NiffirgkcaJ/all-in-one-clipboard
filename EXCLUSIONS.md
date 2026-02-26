# Exclusion Detection
The extension blocks clipboard capture for secure applications by checking your configured exclusion list. There are two levels of exclusion detection available to ensure flexibility and maximum privacy:

## Standard Exclusion Detection (Window-Based)

This is the default and most efficient method of exclusion. When a window comes into focus, the extension checks your exclusion list against the window's properties:
- **Title**
- **Window Class**
- **Application Name**
- **Application ID**

If any of these properties contain an entry from your exclusion list regardless of case, clipboard recording pauses automatically. However, this is sometimes insufficient for applications running *inside* other windows, such as browser extensions.

## Enhanced Exclusion Detection (AT-SPI)

Enhanced Exclusion Detection uses the system's accessibility service, AT-SPI, to detect excluded applications that share the same process and window as their host, like browser extensions.

### How It Works

When enabled, the extension listens for AT-SPI focus events across all accessible applications. Each time an element receives focus, the extension walks up its accessibility ancestor chain and checks if any name matches an entry in the exclusion list. If a match is found, such as when a name from your exclusion list appears in the ancestor chain, clipboard events from that window are blocked until focus moves to a non-excluded top-level element.

### Enabling the Feature

1. Open the extension preferences
2. Navigate to **Excluded Applications**
3. Toggle **Enhanced Exclusion Detection** on
4. Add the application name to the exclusion list

This will automatically enable the system's `toolkit-accessibility` setting if it is not already active.

## Chromium-Based Browsers

Chromium-based browsers do not expose AT-SPI accessibility data by default. You must explicitly enable it for the exclusion detection to work.

### Option 1: Launch Flag

Start the browser with the `--force-renderer-accessibility` flag:

```sh
<chromium-executable> --force-renderer-accessibility
```

### Option 2: Permanent Desktop File Modification

Edit the browser's `.desktop` file to include the flag permanently:

1. Copy the desktop file to your local overrides:

```sh
cp /usr/share/applications/<browser>.desktop ~/.local/share/applications/
```

2. Edit `~/.local/share/applications/<browser>.desktop` and append `--force-renderer-accessibility` to every `Exec=` line. For example:

```
Exec=/usr/bin/<chromium-executable> --force-renderer-accessibility %U
```

3. Log out and log back in, or run `update-desktop-database ~/.local/share/applications/`.

### Option 3: Browser Accessibility Page

Navigate to the browser's internal accessibility page, such as `<browser>://accessibility/`, and enable accessibility for specific pages. This is a per-session setting and does not persist.

## Firefox-Based Browsers

Firefox and its derivatives expose AT-SPI data by default. No additional configuration is needed.

## Performance

- When the toggle is **off**, no AT-SPI listener is registered and there is zero performance overhead.
- When the toggle is **on**, focus events are processed with a lightweight callback that walks 12 ancestor levels per event. This should not cause noticeable performance impact.
- The excluded context flag uses a 500ms debounced clearing to prevent rapid focus transitions from prematurely unblocking clipboard events.

