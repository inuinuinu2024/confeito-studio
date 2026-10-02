import { describe, expect, it } from 'vitest';
import type { GenerationInput } from '../../../shared/api/generation';
import { generateContentRequest, interactionsRequest, redactImageData } from './request';

const INPUT: GenerationInput[] = [
  { type: 'image', mime_type: 'image/png', data: 'AAAA' },
  { type: 'text', text: '# User prompt\nhi' },
];

describe('interactionsRequest', () => {
  it('matches what the tool sent before when only ratio / size / format are set', () => {
    expect(
      interactionsRequest('gemini-3-pro-image', INPUT, { mimeType: 'image/png', aspectRatio: '1:1', imageSize: '1K' }),
    ).toEqual({
      model: 'gemini-3-pro-image',
      input: INPUT,
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '1:1', image_size: '1K' },
    });
  });

  it('leaves out everything that is not set', () => {
    expect(interactionsRequest('m', INPUT, {})).toEqual({
      model: 'm',
      input: INPUT,
      response_format: { type: 'image' },
    });
  });

  it('writes the options in Interactions format', () => {
    expect(
      interactionsRequest('m', INPUT, {
        thinkingLevel: 'high',
        includeThoughts: true,
        seed: 3,
        systemInstruction: 'sys',
        search: 'web+image',
        store: false,
        serviceTier: 'priority',
      }),
    ).toMatchObject({
      generation_config: { thinking_level: 'high', thinking_summaries: 'auto', seed: 3 },
      system_instruction: 'sys',
      tools: [{ type: 'google_search', search_types: ['web_search', 'image_search'] }],
      store: false,
      service_tier: 'priority',
    });
    expect(interactionsRequest('m', INPUT, { search: 'web' }).tools).toEqual([{ type: 'google_search' }]);
  });
});

describe('generateContentRequest', () => {
  it('converts the input into one user content', () => {
    expect(generateContentRequest('m', INPUT, {})).toEqual({
      model: 'm',
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: '# User prompt\nhi' }],
        },
      ],
    });
  });

  it('writes the options in generateContent format', () => {
    const safetySettings = [{ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' }];
    expect(
      generateContentRequest('m', INPUT, {
        aspectRatio: '16:9',
        imageSize: '2K',
        mimeType: 'image/jpeg',
        responseModalities: ['IMAGE'],
        thinkingLevel: 'minimal',
        includeThoughts: false,
        temperature: 0,
        topP: 0.9,
        topK: 20,
        seed: 0,
        safetySettings,
        systemInstruction: 'sys',
        search: 'web',
        store: true,
        serviceTier: 'flex',
      }),
    ).toEqual({
      model: 'm',
      contents: expect.any(Array),
      systemInstruction: { parts: [{ text: 'sys' }] },
      generationConfig: {
        responseModalities: ['IMAGE'],
        temperature: 0,
        topP: 0.9,
        topK: 20,
        seed: 0,
        thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: false },
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
        responseFormat: { image: { mimeType: 'IMAGE_JPEG' } },
      },
      safetySettings,
      tools: [{ googleSearch: {} }],
      serviceTier: 'flex',
      store: true,
    });
    expect(generateContentRequest('m', INPUT, { search: 'web+image' }).tools).toEqual([
      { googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } },
    ]);
  });

  it('does not send PNG as an output format (generateContent only has IMAGE_JPEG)', () => {
    expect(generateContentRequest('m', INPUT, { mimeType: 'image/png' }).generationConfig).toBeUndefined();
  });
});

describe('redactImageData', () => {
  it('replaces image data in both formats without touching the original', () => {
    const interactions = interactionsRequest('m', INPUT, {});
    const generateContent = generateContentRequest('m', INPUT, {});
    expect(redactImageData(interactions, 'X').input[0]).toEqual({ type: 'image', mime_type: 'image/png', data: 'X' });
    expect(redactImageData(generateContent, 'X').contents[0].parts[0]).toEqual({
      inlineData: { mimeType: 'image/png', data: 'X' },
    });
    expect(interactions.input[0]).toMatchObject({ data: 'AAAA' });
  });
});
