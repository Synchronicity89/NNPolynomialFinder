# Static Page

Minimal HTML and JavaScript project with one static page.

## Location

This project is stored in Ubuntu at `/home/baker/projects/static-page`.

## Files

- `index.html`
- `GraphViewport.js`
- `styles.css`
- `script.js`
- `graph-viewport-tests.html`
- `graph-viewport-tests.js`

## Run

Serve the folder locally from Ubuntu:

```bash
cd /home/baker/projects/static-page
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

To run the graph abstraction tests, open `http://localhost:8080/graph-viewport-tests.html`.