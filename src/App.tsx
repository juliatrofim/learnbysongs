import './App.css'

import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'

/** Max characters allowed for lyrics input (to avoid oversized LLM payloads). */
const MAX_LYRICS_LENGTH = 15_000

type UserLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

type LearningItem = {
  id: string
  word: string
  difficultyScore: number
  difficultyBand: 'comfortable' | 'stretch' | 'challenging'
  count: number
  example: string
  explanation?: string // LLM-provided explanation
  translation?: string
  translationError?: string
}

type NativeLanguage = {
  code: string
  label: string
}

const NATIVE_LANGUAGES: NativeLanguage[] = [
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'pl', label: 'Polish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
]

/** Ask the LLM to detect the language of the lyrics. Returns language name in English (e.g. "Spanish", "Dutch"). */
async function detectLyricsLanguage(apiKey: string, lyrics: string): Promise<string> {
  const sample = lyrics.slice(0, 2500).trim()
  const prompt = `Identify the language of the following text. Reply with ONLY the language name in English (e.g. English, Spanish, Dutch, Hindi, Korean). No other text.

Text:
"""
${sample}
"""`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You identify languages. Reply with only the language name in English.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 30,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `Language detection failed: ${errorData.error?.message || response.statusText}`,
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = data.choices?.[0]?.message?.content?.trim() ?? ''
  const name = raw.replace(/\n.*/s, '').trim() || 'English'
  return name
}

const EXAMPLE_LYRICS = `Yesterday, all my troubles seemed so far away
Now it looks as though they're here to stay
Oh, I believe in yesterday

Suddenly, I'm not half the man I used to be
There's a shadow hanging over me
Oh, yesterday came suddenly

Why she had to go I don't know, she wouldn't say
I said something wrong, now I long for yesterday`

/** Export learning items as tab-separated file for Quizlet import (term \t translation only). */
function exportForQuizlet(items: LearningItem[]): void {
  const lines = items.map((item) => {
    const term = item.word
    const definition = item.translation || item.translationError || ''
    return `${term}\t${definition}`
  })
  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'learn-by-song-quizlet.txt'
  a.click()
  URL.revokeObjectURL(url)
}

type LLMWordItem = {
  word: string
  phrase?: string
  difficulty: 'comfortable' | 'stretch' | 'challenging'
  explanation: string
  example: string
}

async function analyzeWithLLM(
  lyrics: string,
  level: UserLevel,
  apiKey: string,
  songLangLabel: string,
): Promise<LearningItem[]> {
  const levelDescriptions: Record<UserLevel, string> = {
    A1: 'beginner (A1) - basic vocabulary, simple words',
    A2: 'elementary (A2) - common everyday words',
    B1: 'intermediate (B1) - moderately complex vocabulary',
    B2: 'upper-intermediate (B2) - advanced vocabulary',
    C1: 'advanced (C1) - sophisticated vocabulary',
    C2: 'proficient (C2) - very advanced and nuanced vocabulary',
  }

  const prompt = `You are a ${songLangLabel} language learning assistant. Analyze the following song lyrics (in ${songLangLabel}) and identify words and phrases that would be appropriate for a learner at ${levelDescriptions[level]} level in ${songLangLabel}.

Song lyrics (${songLangLabel}):
"""
${lyrics}
"""

Please identify words and phrases (2-4 words) that:
1. Are appropriate for ${levelDescriptions[level]} level learners of ${songLangLabel}
2. Would help expand their vocabulary
3. Are not too basic (they should challenge the learner slightly)
4. Include useful idiomatic expressions or phrasal verbs when appropriate for ${songLangLabel}

For each item, provide:
- The word or phrase in ${songLangLabel}
- Difficulty level: "comfortable" (just right), "stretch" (slightly challenging), or "challenging" (more difficult but still appropriate)
- A brief explanation of why this is useful to learn (in English)
- The exact line from the song where it appears

Return your response as a JSON object with a "words" array property:
{
  "words": [
    {
      "word": "example",
      "phrase": "optional phrase if it's a multi-word expression",
      "difficulty": "comfortable",
      "explanation": "brief explanation",
      "example": "exact line from song"
    }
  ]
}

Return ONLY valid JSON, no additional text before or after.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // Using mini for cost efficiency
      messages: [
        {
          role: 'system',
          content:
            `You are a helpful ${songLangLabel} language learning assistant. Always respond with valid JSON only. Return a JSON object with a "words" array.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `LLM API error: ${response.status} - ${errorData.error?.message || response.statusText}`,
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('No response from LLM')
  }

  // Parse JSON response
  let parsed: { words?: LLMWordItem[] } | LLMWordItem[]
  try {
    parsed = JSON.parse(content)
  } catch (err) {
    // Sometimes LLM wraps JSON in markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1])
    } else {
      throw new Error('Invalid JSON response from LLM')
    }
  }

  // Handle both { words: [...] } and [...] formats
  const items: LLMWordItem[] = Array.isArray(parsed)
    ? parsed
    : parsed.words || []

  // Convert to LearningItem format
  const learningItems: LearningItem[] = items.map((item, index) => {
    const displayText = item.phrase || item.word
    const difficultyScore =
      item.difficulty === 'comfortable'
        ? 3
        : item.difficulty === 'stretch'
          ? 5
          : 7

    return {
      id: `${displayText}-${index}`,
      word: displayText,
      difficultyScore,
      difficultyBand: item.difficulty,
      count: 1, // LLM doesn't provide count, default to 1
      example: item.example,
      explanation: item.explanation,
      translation: undefined, // Will be filled later
    }
  })

  return learningItems
}

/** Translate words/phrases from the song's language into the user's language using a strong LLM. */
async function translateWordsWithLLM(
  apiKey: string,
  words: string[],
  sourceLangLabel: string,
  sourceLangCode: string,
  targetLangCode: string,
  targetLangLabel: string,
): Promise<string[]> {
  if (words.length === 0) return []

  const wordList = words.map((w, i) => `${i + 1}. ${w}`).join('\n')

  const prompt = `Translate the following ${sourceLangLabel} words or phrases into ${targetLangLabel} (target language code: ${targetLangCode}).
Source language: ${sourceLangLabel} (${sourceLangCode}).
Return ONLY a JSON object with a "translations" array: one translation per item, in the exact same order.
Each translation should be a single string (the most natural translation for a flashcard).

${sourceLangLabel} items:
${wordList}

Example format: { "translations": ["translation1", "translation2", ...] }
Return ONLY valid JSON, no other text.`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o', // Stronger model for better translation quality
      messages: [
        {
          role: 'system',
          content:
            'You are a translator. Respond only with valid JSON. Return a "translations" array with one string per input item in the same order.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      `Translation API error: ${response.status} - ${errorData.error?.message || response.statusText}`,
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('No response from LLM')

  let parsed: { translations?: string[] }
  try {
    parsed = JSON.parse(content)
  } catch {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch) parsed = JSON.parse(jsonMatch[1])
    else throw new Error('Invalid JSON from translation LLM')
  }

  const translations = parsed.translations || []
  if (translations.length !== words.length) {
    console.warn(
      `Translation count mismatch: got ${translations.length}, expected ${words.length}`,
    )
  }
  return translations
}

function App() {
  const [lyrics, setLyrics] = useState('')
  const [level, setLevel] = useState<UserLevel>('B1')
  const [nativeLang, setNativeLang] = useState<string>('es')
  const [customLangCode, setCustomLangCode] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [learningItems, setLearningItems] = useState<LearningItem[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveLangCode = useMemo(
    () => customLangCode.trim() || nativeLang,
    [customLangCode, nativeLang],
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!lyrics.trim()) {
      setError('Please paste the song lyrics first.')
      return
    }

    if (lyrics.length > MAX_LYRICS_LENGTH) {
      setError(
        `Lyrics are too long (${lyrics.length.toLocaleString()} characters). Maximum is ${MAX_LYRICS_LENGTH.toLocaleString()} characters.`,
      )
      return
    }

    if (!effectiveLangCode) {
      setError('Please choose or enter your native language code.')
      return
    }

    if (!apiKey.trim()) {
      setError('Please enter your OpenAI API key.')
      return
    }

    setIsProcessing(true)
    setIsTranslating(false)
    try {
      const songLangLabel = await detectLyricsLanguage(apiKey.trim(), lyrics)
      const items = await analyzeWithLLM(lyrics, level, apiKey.trim(), songLangLabel)
      setLearningItems(items)
      setIsProcessing(false)

      if (items.length === 0) {
        setError('No learning items found. Try adjusting your level or check the lyrics.')
        return
      }

      setIsTranslating(true)
      const targetLangLabel =
        NATIVE_LANGUAGES.find((l) => l.code === effectiveLangCode)?.label ??
        effectiveLangCode
      const words = items.map((item) => item.word)
      let translations: string[]
      try {
        translations = await translateWordsWithLLM(
          apiKey.trim(),
          words,
          songLangLabel,
          songLangLabel,
          effectiveLangCode,
          targetLangLabel,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Translation failed'
        setLearningItems(
          items.map((item) => ({ ...item, translationError: message })),
        )
        setIsTranslating(false)
        return
      }
      setIsTranslating(false)

      const translatedItems: LearningItem[] = items.map((item, i) => ({
        ...item,
        translation: translations[i],
        translationError: translations[i] ? undefined : 'No translation',
      }))
      setLearningItems(translatedItems)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unexpected error occurred'
      setError(message)
      console.error('Analysis error:', err)
    } finally {
      setIsProcessing(false)
      setIsTranslating(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Learn English by Songs</h1>
        <p className="app-subtitle">
          Paste song lyrics in any language and get a list of words that match
          your level, with translations into your language.
        </p>
      </header>

      <main className="app-main">
        <section className="card card-input">
          <form onSubmit={handleSubmit} className="form">
            <div className="form-row">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <label htmlFor="lyrics" className="form-label" style={{ marginBottom: 0 }}>
                  Song lyrics
                </label>
                <button
                  type="button"
                  onClick={() => setLyrics(EXAMPLE_LYRICS)}
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '0.5rem',
                    background: '#f9fafb',
                    color: '#6b7280',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  Try with example
                </button>
              </div>
              <textarea
                id="lyrics"
                className="textarea"
                rows={10}
                maxLength={MAX_LYRICS_LENGTH}
                placeholder="Paste the full lyrics here..."
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value.slice(0, MAX_LYRICS_LENGTH))}
              />
              <small className="form-help" style={{ marginTop: '0.25rem' }}>
                {lyrics.length.toLocaleString()} / {MAX_LYRICS_LENGTH.toLocaleString()} characters
                {lyrics.length >= MAX_LYRICS_LENGTH && (
                  <span style={{ color: '#b91c1c', fontWeight: 600 }}> (max length reached)</span>
                )}
              </small>
            </div>

            <div className="form-row">
              <label htmlFor="apiKey" className="form-label">
                OpenAI API Key
              </label>
              <input
                id="apiKey"
                type="password"
                className="input"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <small className="form-help">
                Your API key is stored locally and never sent to our servers. Get one at{' '}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#6366f1', textDecoration: 'underline' }}
                >
                  platform.openai.com
                </a>
              </small>
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="level" className="form-label">
                  Your level (in the song&apos;s language)
                </label>
                <select
                  id="level"
                  className="select"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as UserLevel)}
                >
                  <option value="A1">A1 – Beginner</option>
                  <option value="A2">A2 – Elementary</option>
                  <option value="B1">B1 – Intermediate</option>
                  <option value="B2">B2 – Upper‑intermediate</option>
                  <option value="C1">C1 – Advanced</option>
                  <option value="C2">C2 – Proficient</option>
                </select>
              </div>

              <div className="form-row">
                <label htmlFor="nativeLang" className="form-label">
                  Your native language
                </label>
                <select
                  id="nativeLang"
                  className="select"
                  value={nativeLang}
                  onChange={(e) => setNativeLang(e.target.value)}
                >
                  {NATIVE_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <small className="form-help">
                  We use language codes like `es` (Spanish), `ru` (Russian).
                </small>
              </div>

              <div className="form-row">
                <label htmlFor="customLang" className="form-label">
                  Custom language code (optional)
                </label>
                <input
                  id="customLang"
                  className="input"
                  placeholder="Example: `cs` for Czech, `nl` for Dutch..."
                  value={customLangCode}
                  onChange={(e) => setCustomLangCode(e.target.value)}
                />
                <small className="form-help">
                  If filled, this will override the dropdown above.
                </small>
              </div>
            </div>

            <button
              type="submit"
              className="button-primary"
              disabled={isProcessing || isTranslating}
            >
              {isProcessing
                ? 'AI analyzing lyrics...'
                : isTranslating
                  ? 'Translating words...'
                  : 'Find words I should learn'}
            </button>

            {error && <p className="error-text">{error}</p>}
          </form>
        </section>

        <section className="card card-results">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h2 className="card-title" style={{ marginBottom: 0 }}>Words to learn from this song</h2>
            {learningItems.length > 0 && (
              <button
                type="button"
                className="button-primary"
                style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                onClick={() => exportForQuizlet(learningItems)}
              >
                Export for Quizlet
              </button>
            )}
          </div>
          {learningItems.length === 0 && (
            <p className="muted">
              Your list will appear here after you analyze a song.
            </p>
          )}

          {learningItems.length > 0 && (
            <ul className="learning-list">
              {learningItems.map((item) => (
                <li key={item.id} className="learning-item">
                  <div className="learning-main">
                    <div className="learning-word">
                      <span className="learning-word-text">{item.word}</span>
                      <span className="badge">
                        Difficulty: {item.difficultyBand}
                      </span>
                      {item.count > 1 && (
                        <span className="badge badge-soft">
                          appears {item.count}×
                        </span>
                      )}
                    </div>
                    <div className="learning-translation">
                      {item.translation && (
                        <span className="translation-text">
                          {item.translation}
                        </span>
                      )}
                      {item.translationError && (
                        <span className="translation-error">
                          {item.translationError}
                        </span>
                      )}
                      {!item.translation &&
                        !item.translationError &&
                        isTranslating && (
                          <span className="translation-loading">
                            Translating...
                          </span>
                        )}
                    </div>
                  </div>
                  <p className="learning-example">
                    <span className="example-label">Line from song:</span>{' '}
                    <span className="example-text">{item.example}</span>
                  </p>
                  {item.explanation && (
                    <p className="learning-explanation" style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: '#6b7280', fontStyle: 'italic' }}>
                      💡 {item.explanation}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <span>
          This is an educational prototype. Difficulty is estimated
          automatically and meant only as guidance while you learn from music.
        </span>
      </footer>
    </div>
  )
}

export default App
