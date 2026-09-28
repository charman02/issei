// Turn a block of recipe text into a filled-in form.
//
// NOTE (#65): the AI path (`POST /recipes/parse`) also fills THREE fields this parser does not —
// `story`, `ready_in_minutes` and `diet`. That asymmetry is deliberate rather than a gap to close
// here: this parser is header/line-based, and there is no header to key any of the three off. The
// merge is safe either way — `PlantRecipe`'s seed uses `|| undefined` and skips undefined keys —
// so a fallback parse leaves those three untouched rather than blanking them, which is also what
// keeps a #81 mid-post draft's description from being clobbered by a parse that has none.
//
// WHY THIS EXISTS: the add form asks for 19 fields across ~3.9 phone screens, and
// only the dish name is actually required (in the form AND in RecipeCreate). Testers
// called capture "too effortful" and one abandoned mid-input. Meanwhile most recipes
// worth keeping already exist as TEXT somewhere — a note on a phone, a message, a
// caption — so retyping them into 19 boxes is work the app can do instead.
//
// WHAT IT DELIBERATELY DOESN'T DO: guess silently. The caller gets back how much was
// inferred vs. read from the author's own headers, and the review screen lets any line
// move between ingredient and step in one tap. A parser that's confidently wrong costs
// MORE than typing, because you proofread and re-sort instead of just entering.
//
// MEASURED LIMITS (four realistic inputs, probed before this was written):
//   ✓ typed-in-Notes list, no headers        → correct
//   ✓ text with Ingredients:/Instructions:   → correct once headers are trusted
//   ✓ bare nouns, no amounts ("ginger")      → fixed here by the RUN rule below
//   ✗ dictated run-on prose                  → NOT fixable by heuristics. One spoken
//     sentence holds three ingredients; no line-based rule can split it. That's why
//     pasting is an optional door and the guided form still exists.

import { parseQuantity } from '../utils/quantity'

// Section headers people actually paste. When any are present the parser stops
// guessing entirely and obeys them — a header is the author's own classification and
// it beats every heuristic here.
const ING_HEADER =
  /^(ingredients?|you(?:'ll| will)? need|what you(?:'ll| will)? need|shopping list)\s*:?\s*$/i
const STEP_HEADER =
  /^(instructions?|steps?|method|directions?|how to make it|to make it|preparation)\s*:?\s*$/i

// A line opening with an amount is an ingredient. Includes articles and number words,
// because "a good splash of vinegar" and "two bay leaves" are both amounts as far as
// this app is concerned.
const STARTS_WITH_AMOUNT =
  /^(\d|[½¼¾⅓⅔⅛]|a\b|an\b|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b|half\b|some\b|several\b|a few\b|a couple\b|handful\b)/i

// A line opening with a cooking verb is a step. Also catches sequence words ("first",
// "then"), which is how dictated text introduces one.
const STARTS_WITH_VERB =
  /^(add|mix|stir|heat|brown|simmer|boil|bake|fry|saut[eé]|chop|slice|dice|mince|grate|peel|pour|cover|cook|let|bring|remove|serve|season|drain|rinse|soak|marinate|whisk|fold|combine|preheat|reduce|toss|grill|roast|steam|blend|garnish|transfer|set|put|place|leave|keep|taste|adjust|turn|flip|wait|repeat|throw|sprinkle|squeeze|crush|beat|knead|rest|chill|freeze|thaw|wash|cut|trim|discard|scoop|spoon|ladle|top|finish|first|then|next|finally|afterwards?|once|when|while|meanwhile|after)\b/i

const BULLET = /^[-*•·–—]\s*/
// Only with trailing whitespace, so "2 tbsp" survives and "2. Boil" doesn't.
const ORDINAL = /^\d+\s*[.)]\s+/

const isHeader = (l) => ING_HEADER.test(l) || STEP_HEADER.test(l)

const clean = (line) => line.replace(BULLET, '').replace(ORDINAL, '').trim()

// A RUN of short verbless lines is an ingredient list.
//
// This is the rule that fixes the "grandma style" input — `ginger / chicken / green
// papaya / saute the ginger / ...`. Nothing marks those nouns as ingredients: no
// amount, no verb. But three or more consecutive short verbless lines IS a list, and a
// list of bare nouns in a recipe is its ingredients. Written as a run rather than
// per-line because one bare noun is ambiguous while four in a row are not.
const RUN_MIN = 3
const SHORT_WORDS = 4

function isBareNoun(line) {
  if (!line) return false
  if (STARTS_WITH_VERB.test(line)) return false
  if (/[.!?]$/.test(line)) return false // a sentence, not a list item
  return line.split(/\s+/).length <= SHORT_WORDS
}

export function parseRecipeText(raw) {
  const lines = (raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (!lines.length) {
    return {
      name: '',
      ingredients: [],
      steps: [],
      usedHeaders: false,
      guessedLines: 0,
    }
  }

  // The first line is the dish name — unless it's a header, in which case the paste
  // began with "Ingredients:" and the name isn't in the text at all.
  const hasNameLine = !isHeader(lines[0])
  const name = hasNameLine ? clean(lines[0]) : ''
  const body = lines.slice(hasNameLine ? 1 : 0)

  const usedHeaders = body.some(isHeader)
  const cleaned = body.map(clean)

  // Pre-compute which bare-noun lines belong to the ingredient list, so
  // classification can look at NEIGHBOURS rather than at one line in isolation.
  // Skipped entirely when headers are present, because then there's nothing to infer.
  //
  // Two ways a bare noun qualifies:
  //   RUN   — three or more consecutive bare nouns are a list ("ginger / chicken /
  //           green papaya"). One is ambiguous; three are not.
  //   TOUCH — a bare noun sitting directly beside a line that opens with an AMOUNT is
  //           part of that list. Caught in a real browser test: a paste ending
  //           "...a bunch of kangkong / tamarind / Boil the pork..." filed the lone
  //           "tamarind" as Step 1, because it was one bare noun rather than three.
  //           Nobody writes an ingredient list and then a one-word instruction.
  const inRun = new Array(cleaned.length).fill(false)
  if (!usedHeaders) {
    const bare = cleaned.map((l, i) => !isHeader(body[i]) && isBareNoun(l))
    const amountLed = cleaned.map((l, i) => !isHeader(body[i]) && STARTS_WITH_AMOUNT.test(l))

    let i = 0
    while (i < cleaned.length) {
      if (!bare[i]) {
        i += 1
        continue
      }
      let j = i
      while (j < cleaned.length && bare[j]) j += 1
      // The run itself, plus whatever sits immediately either side of it.
      const longEnough = j - i >= RUN_MIN
      const touchesAmount = amountLed[i - 1] || amountLed[j]
      if (longEnough || touchesAmount) for (let k = i; k < j; k += 1) inRun[k] = true
      i = j
    }
  }

  const ingredients = []
  const steps = []
  let mode = null // null = infer · 'ing' · 'step'
  let guessedLines = 0

  body.forEach((rawLine, i) => {
    if (ING_HEADER.test(rawLine)) {
      mode = 'ing'
      return
    }
    if (STEP_HEADER.test(rawLine)) {
      mode = 'step'
      return
    }
    const text = cleaned[i]
    if (!text) return

    if (mode === 'ing') {
      // An unmistakable cooking verb ends the ingredient list even without an
      // "Instructions:" header — people paste half a page, or drop the second header.
      // Without this escape, "Ingredients: / 2 cups rice / Boil it" filed "Boil it" as
      // an ingredient and produced zero steps.
      if (STARTS_WITH_VERB.test(text)) {
        mode = 'step'
        steps.push(text)
        return
      }
      ingredients.push(text)
      return
    }
    if (mode === 'step') {
      steps.push(text)
      return
    }

    // No header to obey — infer, and count it, so the caller can say how much of this
    // was a guess rather than presenting all of it as fact.
    guessedLines += 1
    if (STARTS_WITH_VERB.test(text)) steps.push(text)
    else if (STARTS_WITH_AMOUNT.test(text) || inRun[i]) ingredients.push(text)
    // Long, verbless, not in a run: prose. A step is the safer default — a mis-filed
    // step still reads as a sentence, a mis-filed ingredient is nonsense.
    else steps.push(text)
  })

  return {
    name,
    ingredients: ingredients.map(splitAmount),
    steps,
    usedHeaders,
    guessedLines,
  }
}

// Unit words that belong to a preceding number: "1 CUP rice" → amount "1 cup".
const UNIT_WORD =
  /^(cups?|tbsps?|tablespoons?|tsps?|teaspoons?|g|grams?|kg|oz|ounces?|lbs?|pounds?|ml|l|litres?|liters?|cloves?|slices?|pieces?|cans?|packs?|packets?|bunch(?:es)?|sprigs?|stalks?|heads?|pinch(?:es)?|dash(?:es)?|splash(?:es)?|handfuls?|knobs?|thumbs?|glugs?|drops?|sticks?|spoons?|bowls?|scoops?|heaps?)$/i

// Split "3 soup spoons soy sauce" into an amount and a name.
//
// The amount runs through parseQuantity — the same function the ingredient field uses
// — so a folk unit stays `imprecise` and the words stay verbatim. That is the point of
// the entire product, and a parser that normalised here would undo it.
export function splitAmount(line) {
  // "of" is the reliable hinge: "a good splash OF vinegar".
  const ofMatch = line.match(/^(.+?)\s+of\s+(.+)$/i)
  if (ofMatch) return build(ofMatch[1], ofMatch[2])

  const numMatch = line.match(
    /^((?:\d+\s+\d+\/\d+|\d+\/\d+|[½¼¾⅓⅔⅛]|\d*\.?\d+))\s+(.*)$/,
  )
  if (numMatch) {
    const rest = numMatch[2].split(/\s+/)
    // A two-word folk unit ("3 soup spoons soy sauce") — check the pair first.
    if (rest.length > 2 && UNIT_WORD.test(rest[1])) {
      return build(`${numMatch[1]} ${rest[0]} ${rest[1]}`, rest.slice(2).join(' '))
    }
    if (rest.length > 1 && UNIT_WORD.test(rest[0])) {
      return build(`${numMatch[1]} ${rest[0]}`, rest.slice(1).join(' '))
    }
    // "2 bay leaves" — the number is the whole amount.
    return build(numMatch[1], rest.join(' '))
  }

  const words = line.split(/\s+/)
  if (words.length > 1 && /^(a|an|some|several)$/i.test(words[0])) {
    return build(words[0], words.slice(1).join(' '))
  }

  // No number, no "of", no article — the whole line is the ingredient and there is no
  // amount. That's a legitimate recipe ("ginger"), not a parse failure.
  return { amount: '', name: line, quantity_type: 'unmeasured' }
}

function build(amount, name) {
  const a = amount.trim()
  return {
    amount: a,
    name: name.trim(),
    quantity_type: parseQuantity(a).quantity_type,
  }
}
