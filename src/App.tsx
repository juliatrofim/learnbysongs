import './App.css'

import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { getWordFrequencyTier } from './wordFrequency'

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

// Very small set of high‑frequency function words that we almost
// never want to highlight as “words to learn”.
const STOP_WORDS = new Set([
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'me',
  'him',
  'her',
  'them',
  'my',
  'your',
  'his',
  'their',
  'our',
  'and',
  'or',
  'but',
  'so',
  'because',
  'if',
  'when',
  'while',
  'in',
  'on',
  'at',
  'with',
  'for',
  'from',
  'to',
  'of',
  'a',
  'an',
  'the',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'this',
  'that',
  'these',
  'those',
  'here',
  'there',
  'up',
  'down',
  'out',
  'into',
  'over',
  'under',
  'again',
  'very',
  'just',
  'then',
  'now',
  'not',
  "don't",
  "doesn't",
  "didn't",
])

// Map the user‑reported level to a difficulty threshold.
// Higher threshold = we only show more complex words.
const LEVEL_DIFFICULTY_THRESHOLD: Record<UserLevel, number> = {
  A1: 2,
  A2: 3,
  B1: 4,
  B2: 5,
  C1: 6,
  C2: 7,
}

function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^a-z']+|[^a-z']+$/gi, '')
}

function estimateSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!cleaned) return 0
  const matches = cleaned.match(/[aeiouy]+/g)
  if (!matches) return 1
  const count = matches.length
  return Math.max(1, count)
}

function estimateDifficultyScore(word: string): number {
  // PRIMARY FACTOR: Word frequency (most important)
  // Frequency tier: 1 (most common) to 5 (rare/unknown)
  // We invert it so rare words get higher scores: tier 5 → 4 points, tier 1 → 0 points
  const frequencyTier = getWordFrequencyTier(word)
  let score = 5 - frequencyTier // Tier 1 → 0, Tier 2 → 1, Tier 3 → 2, Tier 4 → 3, Tier 5 → 4

  // SECONDARY FACTORS: Structural complexity (smaller adjustments)
  const len = word.length

  // Length contributes slightly to difficulty (only for longer words)
  if (len >= 10) score += 1
  if (len >= 12) score += 1

  // Syllable complexity (only for very complex words)
  const syllables = estimateSyllables(word)
  if (syllables >= 4) score += 1
  if (syllables >= 5) score += 1

  // Academic/abstract suffixes (adds complexity)
  if (
    /(tion|sion|ment|less|ship|ance|ence|ious|eous|tive|ward|wise|ism|ity|ness)$/i.test(
      word,
    )
  ) {
    score += 1
  }

  // Less common letter patterns (adds slight complexity)
  if (/(ph|que|rh|zh|ch|sh|x|z)/i.test(word)) {
    score += 0.5
  }

  return Math.round(score * 10) / 10 // Round to 1 decimal place
}

function toDifficultyBand(score: number, threshold: number): LearningItem['difficultyBand'] {
  if (score <= threshold) return 'comfortable'
  if (score <= threshold + 2) return 'stretch'
  return 'challenging'
}

function splitIntoExamples(text: string): string[] {
  return text
    .split(/[\n\.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function extractLearningItems(
  lyrics: string,
  level: UserLevel,
): LearningItem[] {
  const examples = splitIntoExamples(lyrics)
  const wordStats = new Map<
    string,
    { count: number; score: number; example: string }
  >()

  const threshold = LEVEL_DIFFICULTY_THRESHOLD[level]

  // Logging structure
  const logData: {
    allWords: Array<{
      raw: string
      normalized: string
      score: number
      frequencyTier: number
      reason: string
      included: boolean
    }>
    summary: {
      totalWords: number
      stopWords: number
      tooEasy: number
      containsDigits: number
      empty: number
      included: number
    }
  } = {
    allWords: [],
    summary: {
      totalWords: 0,
      stopWords: 0,
      tooEasy: 0,
      containsDigits: 0,
      empty: 0,
      included: 0,
    },
  }

  for (const ex of examples) {
    const rawWords = ex.split(/\s+/)
    for (const raw of rawWords) {
      logData.summary.totalWords++
      const w = normalizeWord(raw)
      
      if (!w) {
        logData.allWords.push({
          raw,
          normalized: '',
          score: 0,
          frequencyTier: 0,
          reason: 'empty after normalization',
          included: false,
        })
        logData.summary.empty++
        continue
      }

      if (STOP_WORDS.has(w)) {
        logData.allWords.push({
          raw,
          normalized: w,
          score: 0,
          frequencyTier: getWordFrequencyTier(w),
          reason: 'stop word',
          included: false,
        })
        logData.summary.stopWords++
        continue
      }

      // Skip obviously non‑lexical items like numbers or all‑caps acronyms.
      if (/\d/.test(w)) {
        logData.allWords.push({
          raw,
          normalized: w,
          score: 0,
          frequencyTier: 0,
          reason: 'contains digits',
          included: false,
        })
        logData.summary.containsDigits++
        continue
      }

      const frequencyTier = getWordFrequencyTier(w)
      const score = estimateDifficultyScore(w)
      if (score <= threshold) {
        logData.allWords.push({
          raw,
          normalized: w,
          score,
          frequencyTier,
          reason: `too easy (score ${score} <= threshold ${threshold})`,
          included: false,
        })
        logData.summary.tooEasy++
        continue
      }

      // Word passed all filters
      logData.allWords.push({
        raw,
        normalized: w,
        score,
        frequencyTier,
        reason: `included (score ${score} > threshold ${threshold})`,
        included: true,
      })
      logData.summary.included++

      const current = wordStats.get(w)
      if (current) {
        current.count += 1
        // keep first example
      } else {
        wordStats.set(w, { count: 1, score, example: ex })
      }
    }
  }

  const items: LearningItem[] = Array.from(wordStats.entries()).map(
    ([word, info]) => ({
      id: word,
      word,
      difficultyScore: info.score,
      difficultyBand: toDifficultyBand(info.score, threshold),
      count: info.count,
      example: info.example,
    }),
  )

  items.sort((a, b) => {
    const byScore = b.difficultyScore - a.difficultyScore
    if (byScore !== 0) return byScore
    return b.count - a.count
  })

  // Console logging
  console.group('🎵 Song Analysis Log')
  console.log(`User Level: ${level} (threshold: ${threshold})`)
  console.log(`Total words processed: ${logData.summary.totalWords}`)
  console.group('📊 Summary')
  console.log(`✅ Included: ${logData.summary.included}`)
  console.log(`🚫 Stop words: ${logData.summary.stopWords}`)
  console.log(`⬇️  Too easy: ${logData.summary.tooEasy}`)
  console.log(`🔢 Contains digits: ${logData.summary.containsDigits}`)
  console.log(`⚪ Empty: ${logData.summary.empty}`)
  console.groupEnd()
  
  console.group('📝 All Words (with scores)')
  console.log('Frequency tiers: 1=most common, 2=very common, 3=common, 4=less common, 5=rare')
  logData.allWords.forEach((entry) => {
    const icon = entry.included ? '✅' : '❌'
    const style = entry.included
      ? 'color: #10b981; font-weight: bold;'
      : 'color: #6b7280;'
    const tierLabel = entry.frequencyTier > 0 ? `Tier ${entry.frequencyTier}` : 'N/A'
    console.log(
      `%c${icon} "${entry.raw}" → "${entry.normalized}" | Score: ${entry.score} | Freq: ${tierLabel} | ${entry.reason}`,
      style,
    )
  })
  console.groupEnd()

  console.group('🎯 Final Learning Items')
  items.forEach((item) => {
    const tier = getWordFrequencyTier(item.word)
    console.log(
      `"${item.word}" | Score: ${item.difficultyScore} | Freq Tier: ${tier} | Band: ${item.difficultyBand} | Count: ${item.count}`,
    )
  })
  console.groupEnd()
  console.groupEnd()

  return items
}

async function translateText(
  text: string,
  targetLangCode: string,
): Promise<string> {
  // Simple free translation API (MyMemory). For a production app,
  // you may want to plug in your own API + key instead.
  const url = new URL('https://api.mymemory.translated.net/get')
  url.searchParams.set('q', text)
  url.searchParams.set('langpair', `en|${targetLangCode}`)

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = (await res.json()) as {
    responseData?: { translatedText?: string }
  }

  const translated = data.responseData?.translatedText
  if (!translated) {
    throw new Error('No translation in response')
  }

  return translated
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
): Promise<LearningItem[]> {
  const levelDescriptions: Record<UserLevel, string> = {
    A1: 'beginner (A1) - basic vocabulary, simple words',
    A2: 'elementary (A2) - common everyday words',
    B1: 'intermediate (B1) - moderately complex vocabulary',
    B2: 'upper-intermediate (B2) - advanced vocabulary',
    C1: 'advanced (C1) - sophisticated vocabulary',
    C2: 'proficient (C2) - very advanced and nuanced vocabulary',
  }

  const prompt = `You are an English language learning assistant. Analyze the following song lyrics and identify words and phrases that would be appropriate for a learner at ${levelDescriptions[level]} level.

Song lyrics:
"""
${lyrics}
"""

Please identify words and phrases (2-4 words) that:
1. Are appropriate for ${levelDescriptions[level]} level learners
2. Would help expand their vocabulary
3. Are not too basic (they should challenge the learner slightly)
4. Include useful idiomatic expressions or phrasal verbs when appropriate

For each item, provide:
- The word or phrase
- Difficulty level: "comfortable" (just right), "stretch" (slightly challenging), or "challenging" (more difficult but still appropriate)
- A brief explanation of why this is useful to learn
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
            'You are a helpful English language learning assistant. Always respond with valid JSON only. Return a JSON object with a "words" array.',
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

type AnalysisMethod = 'frequency' | 'llm'

function App() {
  const [lyrics, setLyrics] = useState('')
  const [level, setLevel] = useState<UserLevel>('B1')
  const [nativeLang, setNativeLang] = useState<string>('es')
  const [customLangCode, setCustomLangCode] = useState('')
  const [analysisMethod, setAnalysisMethod] = useState<AnalysisMethod>('frequency')
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

    if (!effectiveLangCode) {
      setError('Please choose or enter your native language code.')
      return
    }

    if (analysisMethod === 'llm' && !apiKey.trim()) {
      setError('Please enter your OpenAI API key for LLM analysis.')
      return
    }

    setIsProcessing(true)
    setIsTranslating(false)
    try {
      let items: LearningItem[]

      if (analysisMethod === 'llm') {
        console.log('🤖 Using LLM-based analysis...')
        items = await analyzeWithLLM(lyrics, level, apiKey.trim())
        console.log(`✅ LLM found ${items.length} learning items`)
      } else {
        console.log('📊 Using frequency-based analysis...')
        items = extractLearningItems(lyrics, level)
        console.log(`✅ Frequency analysis found ${items.length} learning items`)
      }

      setLearningItems(items)
      setIsProcessing(false)

      if (items.length === 0) {
        setError(
          analysisMethod === 'llm'
            ? 'No learning items found. Try adjusting your level or check the lyrics.'
            : 'No learning items found. The song might be too simple for your level.',
        )
        return
      }

      setIsTranslating(true)

      const translatedItems: LearningItem[] = await Promise.all(
        items.map(async (item) => {
          try {
            const translation = await translateText(
              item.word,
              effectiveLangCode,
            )
            return { ...item, translation }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error'
            return {
              ...item,
              translationError: `Translation failed: ${message}`,
            }
          }
        }),
      )

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
        <h1 className="app-title">Learn English by Song Vibes</h1>
        <p className="app-subtitle">
          Paste any English song and get a list of words that match what you
          should learn at your level, with translations into your language.
          Choose between frequency-based analysis (free) or AI-powered LLM analysis.
        </p>
      </header>

      <main className="app-main">
        <section className="card card-input">
          <form onSubmit={handleSubmit} className="form">
            <div className="form-row">
              <label htmlFor="lyrics" className="form-label">
                Song lyrics (English)
              </label>
              <textarea
                id="lyrics"
                className="textarea"
                rows={10}
                placeholder="Paste the full lyrics here..."
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
              />
            </div>

            <div className="form-row">
              <label className="form-label">Analysis Method</label>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="analysisMethod"
                    value="frequency"
                    checked={analysisMethod === 'frequency'}
                    onChange={(e) => setAnalysisMethod(e.target.value as AnalysisMethod)}
                  />
                  <span>Frequency-based (Free, Fast)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="analysisMethod"
                    value="llm"
                    checked={analysisMethod === 'llm'}
                    onChange={(e) => setAnalysisMethod(e.target.value as AnalysisMethod)}
                  />
                  <span>LLM-based (AI-powered, Requires API Key)</span>
                </label>
              </div>
              <small className="form-help">
                {analysisMethod === 'frequency'
                  ? 'Uses word frequency data to identify appropriate vocabulary.'
                  : 'Uses AI to intelligently identify words and phrases matching your level.'}
              </small>
            </div>

            {analysisMethod === 'llm' && (
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
            )}

            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="level" className="form-label">
                  Your English level
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
                ? analysisMethod === 'llm'
                  ? 'AI analyzing lyrics...'
                  : 'Analyzing lyrics...'
                : isTranslating
                  ? 'Translating words...'
                  : 'Find words I should learn'}
            </button>

            {error && <p className="error-text">{error}</p>}
          </form>
        </section>

        <section className="card card-results">
          <h2 className="card-title">Words to learn from this song</h2>
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
