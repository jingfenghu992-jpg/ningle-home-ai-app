/**
 * Shared StepFun image client helpers.
 * Keep payload field names aligned with the proven implementation in api/design/generate.js.
 */

export async function stepfunT2I({
  apiKey,
  model = 'step-1x-medium',
  prompt,
  size,
  n = 1,
  response_format,
  seed,
  steps,
  cfg_scale,
}) {
  return await fetch('https://api.stepfun.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      n,
      response_format,
      seed,
      steps,
      cfg_scale,
    }),
  });
}

export async function stepfunImage2Image({
  apiKey,
  model = 'step-1x-medium',
  prompt,
  source_url,
  source_weight,
  size,
  n = 1,
  response_format,
  seed,
  steps,
  cfg_scale,
}) {
  return await fetch('https://api.stepfun.com/v1/images/image2image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      source_url,
      source_weight,
      size,
      n,
      response_format,
      seed,
      steps,
      cfg_scale,
    }),
  });
}

