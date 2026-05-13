# Cameracal Services – Sensor Dust Verification Web App V1

A browser-based prototype for the Cameracal Services Sensor Health Check / Dust Verification tool.

## Included features
- Cameracal Services branded interface
- Upload JPEG/PNG/TIFF/WebP dust-test image
- Auto dust detection with adjustable sensitivity and minimum spot size
- Annotated overlay map with numbered contamination points
- Manual mark and erase tools
- Severity rating and recommended action
- Indicative contamination pattern classification
- Auto Clean Preview / clone-style cleanup preview
- Save annotated PNG
- Paid-state report generation demo
- Printable PDF-style report via browser Print > Save as PDF
- In-person cleaning and Peli case collection/return service CTA wording

## Production notes for developer
- The “Developer demo: unlock paid report” checkbox must be replaced with Stripe/PayPal payment confirmation.
- The PDF report is generated as printable HTML in a new browser window. This can be converted to jsPDF or server-side PDF generation if required.
- RAW files are not decoded in-browser in this V1. Recommended workflow: export JPEG/TIFF dust-test image from the user’s chosen software.
- Auto Clean Preview is intentionally described as a preview only, not critical retouching or a substitute for sensor cleaning.

## How to run
Open `index.html` in a modern browser. If local browser restrictions occur, run:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## V1.1 update
- Updated to the blue/white Cameracal Services layout.
- Added supplied Cameracal Services logo asset.
- Updated contact telephone number to 07540 877068 in the web interface and report CTA.
