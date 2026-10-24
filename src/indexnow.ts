export const INDEXNOW_KEY = 'mcpx402a1b2c3d4e5f67890abcdef123';
export const INDEXNOW_KEY_FILE = `${INDEXNOW_KEY}.txt`;
export const HOST_DOMAIN = 'mcpx.harrykrauze.com';

export const CANONICAL_URLS = [
  `https://${HOST_DOMAIN}/`,
  `https://${HOST_DOMAIN}/llms.txt`,
  `https://${HOST_DOMAIN}/llms-full.txt`
];

export async function submitIndexNow(): Promise<{ status: number; text: string }> {
  const payload = {
    host: HOST_DOMAIN,
    key: INDEXNOW_KEY,
    keyLocation: `https://${HOST_DOMAIN}/${INDEXNOW_KEY_FILE}`,
    urlList: CANONICAL_URLS
  };

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    return {
      status: response.status,
      text
    };
  } catch (error) {
    return {
      status: 500,
      text: error instanceof Error ? error.message : 'IndexNow submission failed'
    };
  }
}
