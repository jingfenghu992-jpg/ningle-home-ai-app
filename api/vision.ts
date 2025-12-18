import { IncomingMessage, ServerResponse } from 'http'

const readBody = (req: IncomingMessage): Promise<any> => {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

export const visionHandler = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  const body = await readBody(req)
  
  // C) 修复图片“假收到”问题：严格校验
  if (!body.image || !body.image.startsWith('data:image/')) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ 
      ok: false, 
      message: 'Image payload missing or invalid',
      errorCode: 'INVALID_PAYLOAD'
    }))
    return
  }

  // Mock Vision Analysis
  res.setHeader('Content-Type', 'application/json')
  
  // Return a mock summary
  res.end(JSON.stringify({
    ok: true,
    vision_summary: "照片顯示一個典型的香港住宅空間，光線充足。可見一面白牆和木質地板。",
    extraction: {
        roomTypeGuess: "客廳",
        camera: { shotType: "Wide", viewpointHeight: "Eye Level" },
        composition: { horizonLine: "Middle" },
        openings: { windowsDoors: [] },
        fixedElements: { beamsColumns: "None" },
        surfaces: { floor: "Wood", walls: "White" },
        lighting: { daylightDirection: "Left" }
    }
  }))
}

export default visionHandler;
