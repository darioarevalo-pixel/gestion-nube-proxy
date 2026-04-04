export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: 'Falta el parámetro path' });

  const apiKey = req.headers['authorization'];
  const baseUrl = req.headers['x-api-base'];

  if (!baseUrl) return res.status(400).json({ error: 'Falta x-api-base header' });

  try {
    const url = `${baseUrl}/${path}`;
    const response = await fetch(url, {
      method: req.method,
      headers: {
        'Authorization': apiKey || '',
        'Content-Type': 'application/json'
      },
      body: ['POST', 'PUT'].includes(req.method) ? JSON.stringify(req.body) : undefined
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
