const http = require('http');

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Live Fixture</title>
  </head>
  <body>
    <main>
      <h1>Maintenance Kernel Fixture</h1>
      <button id="launch-button">Launch</button>
      <div id="message">Loading...</div>
    </main>
    <script>
      fetch('/api/message')
        .then((response) => response.json())
        .then((payload) => {
          document.getElementById('message').textContent = payload.message;
        });
    </script>
  </body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/api/message') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Kernel ready' }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});

const port = Number(process.env.PORT || 3100);
server.listen(port, '127.0.0.1', () => {
  console.log(`fixture listening on ${port}`);
});
