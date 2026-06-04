addEventListener('fetch', event => {
  event.respondWith(handleRequest(event))
})

function resizeAmazonImage(url, size = 300) {
  if (!url) return url
  // Only images/I/ CDN URLs support size modifiers; images/P/ does not
  if (!url.includes('/images/I/')) return url
  return url.replace(/\.(jpg|png|webp)(\?.*)?$/i, `._SL${size}_.$1`)
}

async function handleRequest(event) {
  const request = event.request
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json',
  }

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'No url param' }), { headers: cors })
  }

  // Check Cloudflare cache first
  const cache = caches.default
  const cacheKey = new Request(request.url)
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    })

    const html = await res.text()
    const finalUrl = res.url

    let image = null
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/)
    const ogMatch2 = html.match(/content="([^"]+)"\s+property="og:image"/)
    const twitterMatch = html.match(/name="twitter:image"\s+content="([^"]+)"/)
    const hiResMatch = html.match(/"hiRes"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.(?:jpg|png|webp))"/)
    const largeMatch = html.match(/"large"\s*:\s*"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+\.(?:jpg|png|webp))"/)
    const dataHiRes = html.match(/data-old-hires="(https:\/\/[^"]+\.(?:jpg|png|webp))"/)
    const amazonImg = html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9%+._-]+\.(?:jpg|png|webp)/)
    const amazonImg2 = html.match(/https:\/\/images-na\.ssl-images-amazon\.com\/images\/I\/[A-Za-z0-9%+._-]+\.(?:jpg|png|webp)/)

    if (ogMatch) image = ogMatch[1]
    else if (ogMatch2) image = ogMatch2[1]
    else if (twitterMatch) image = twitterMatch[1]
    else if (hiResMatch) image = hiResMatch[1]
    else if (largeMatch) image = largeMatch[1]
    else if (dataHiRes) image = dataHiRes[1]
    else if (amazonImg) image = amazonImg[0]
    else if (amazonImg2) image = amazonImg2[0]

    // Try data-a-dynamic-image (HTML-encoded JSON map of image URLs → sizes)
    if (!image) {
      const dynMatch = html.match(/data-a-dynamic-image="([^"]+)"/)
      if (dynMatch) {
        try {
          const decoded = dynMatch[1].replace(/&quot;/g, '"')
          const imgMap = JSON.parse(decoded)
          image = Object.keys(imgMap)[0] || null
        } catch(e) {}
      }
    }

    const asinMatch = finalUrl.match(/\/dp\/([A-Z0-9]{10})/)
    const asin = asinMatch ? asinMatch[1] : null

    if (!image && asin) {
      image = `https://images-na.ssl-images-amazon.com/images/P/${asin}.jpg`
    }

    image = resizeAmazonImage(image, 300)

    const titleMatch = html.match(/<title>([^<]+)<\/title>/)
    const title = titleMatch ? titleMatch[1].trim() : null

    const payload = JSON.stringify({ image, asin, title, finalUrl })
    const response = new Response(payload, {
      headers: {
        ...cors,
        'Cache-Control': 'public, max-age=86400', // cache for 24 hours
      },
    })

    // Store in Cloudflare edge cache
    event.waitUntil(cache.put(cacheKey, response.clone()))

    return response

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: cors,
    })
  }
}
