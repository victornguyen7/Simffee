/** Hand-written customer-movement sketches for the Ask page when the local API
 *  cannot answer. Illustrative F&B behaviour only — nothing here is simulated. */
export interface MockAnswer {
  headline: string
  movements: string[]
  drivers: string[]
  net: string
}

export const MOCK_ANSWERS: MockAnswer[] = [
  {
    headline: 'Earlier opening pulls the commuter crowd back',
    movements: [
      '3 regulars who had drifted to Starbucks for the 6:30 rush come back within two days',
      '1 customer keeps skipping coffee on weekdays — the new hours never reach her',
      '5 never left; their habit held through the change',
    ],
    drivers: ['opening hours', 'habit'],
    net: '+3 customers on the final day vs day 1',
  },
  {
    headline: 'A price cut is noticed, but only by the price-sensitive',
    movements: [
      '2 students switch from the cheaper kiosk after the latte drops below their threshold',
      '1 regular tries the discount once, then returns to his usual bakery for the pastries',
      '6 keep buying exactly as before — price was never their reason',
    ],
    drivers: ['price', 'product range'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'A new competitor across the street splits the morning',
    movements: [
      '4 curious regulars try the newcomer on its opening day',
      '2 of them come back by day 6, citing the wait and a weaker espresso',
      '2 stay lost — the newcomer is closer to their bus stop',
    ],
    drivers: ['novelty', 'distance', 'wait time'],
    net: '−2 customers on the final day vs day 1',
  },
  {
    headline: 'Adding pastries keeps people who were leaving for breakfast',
    movements: [
      '2 customers who used to buy coffee here and a croissant elsewhere now do both in one stop',
      '1 late-morning customer starts coming daily instead of three times a week',
      'nobody leaves; the menu grew without a price change',
    ],
    drivers: ['product range', 'convenience'],
    net: '+2 customers on the final day vs day 1',
  },
  {
    headline: 'A loyalty card changes frequency more than loyalty',
    movements: [
      '3 existing regulars visit an extra day each week to chase the stamp',
      '0 new customers arrive — nobody outside hears about it',
      '1 customer who was drifting away stays for the free tenth cup',
    ],
    drivers: ['rewards', 'habit'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Longer waits quietly bleed the lunch crowd',
    movements: [
      '2 office workers switch to the grab-and-go kiosk after two long queues in a row',
      '1 comes back on day 5 when the queue clears; the other has a new routine',
      '7 never left — they come at off-peak hours and never saw a queue',
    ],
    drivers: ['wait time', 'routine'],
    net: '−1 customer on the final day vs day 1',
  },
  {
    headline: 'A competitor raising prices sends a trickle your way',
    movements: [
      '2 of Starbucks’ price-sensitive regulars try you within three days',
      '1 stays; the other returns because his colleagues still meet there',
      'your own regulars do not react at all',
    ],
    drivers: ['price', 'social habit'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Reverting every change restores the old pattern — slowly',
    movements: [
      '2 customers who left during the price hike return once they notice the old menu',
      '1 formed a new habit elsewhere and does not come back within the week',
      'the rest never noticed anything had changed',
    ],
    drivers: ['habit', 'price'],
    net: '+2 customers on the final day vs day 1',
  },
  {
    headline: 'Marketing reaches people, but only the undecided move',
    movements: [
      '1 new customer from the nearby office tries you after seeing the flyer',
      '1 lapsed regular is reminded and returns',
      'competitor regulars see the same flyer and stay where they are',
    ],
    drivers: ['awareness', 'habit'],
    net: '+2 customers on the final day vs day 1',
  },
  {
    headline: 'Closing earlier loses the after-work coffee without anyone complaining',
    movements: [
      '2 evening customers switch to the convenience store’s machine coffee',
      '1 shifts her visit to the morning instead of leaving',
      'nobody mentions the hours — they simply stop showing up',
    ],
    drivers: ['opening hours', 'convenience'],
    net: '−2 customers on the final day vs day 1',
  },
  {
    headline: 'Free wifi turns the mid-afternoon lull into a laptop crowd',
    movements: [
      '3 freelancers who used to camp at the library move in between 2pm and 5pm',
      '1 regular who liked the quiet shifts her visit to the morning',
      'sales per seat drop as people nurse one americano for two hours',
    ],
    drivers: ['amenities', 'dwell time'],
    net: '+2 customers on the final day vs day 1',
  },
  {
    headline: 'A rainy week moves everyone to whoever is closest',
    movements: [
      '2 of your regulars from the far side of the square switch to the shop under the arcade',
      '2 Starbucks regulars who work above you come down instead of crossing the street',
      'both drifts reverse the first dry morning',
    ],
    drivers: ['distance', 'weather'],
    net: '0 customers on the final day vs day 1',
  },
  {
    headline: 'Mobile ordering pulls in the people who never had time to queue',
    movements: [
      '2 commuters who skipped coffee on late mornings now order from the bus',
      '1 regular stops chatting at the counter and just grabs the cup',
      'the queue looks shorter, so 1 walk-in who used to leave now stays',
    ],
    drivers: ['convenience', 'wait time'],
    net: '+3 customers on the final day vs day 1',
  },
  {
    headline: 'Oat milk as default upsets two people and wins four',
    movements: [
      '4 lactose-avoiding customers from the juice bar start coming for the flat white',
      '2 long-time regulars grumble, ask for dairy, and stay once they can',
      '1 leaves over the surcharge and does not come back',
    ],
    drivers: ['product range', 'price'],
    net: '+3 customers on the final day vs day 1',
  },
  {
    headline: 'A single bad review reaches the undecided, not the regulars',
    movements: [
      '1 first-timer reads it and picks Starbucks instead',
      '0 regulars change anything — they trust their own cup',
      'a week later the review has scrolled off and the effect is gone',
    ],
    drivers: ['reputation', 'habit'],
    net: '−1 customer on the final day vs day 1',
  },
  {
    headline: 'A new barista changes who feels welcome',
    movements: [
      '2 regulars who came for the old barista’s chat drift to the bakery where he now works',
      '3 customers who found the old counter cliquey start staying longer',
      'drink quality is unchanged; the movement is entirely social',
    ],
    drivers: ['staff', 'social habit'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Seasonal pumpkin drinks pull a crowd that leaves with the season',
    movements: [
      '4 Starbucks regulars try your version in the first week',
      '1 stays for the espresso underneath; 3 go back when the special ends',
      'your own regulars order their usual and ignore the board',
    ],
    drivers: ['novelty', 'product range'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Raising the latte by 5k loses nobody for a week, then two',
    movements: [
      'nobody reacts on day 1 — regulars pay without checking',
      '2 students notice on payday and switch to the kiosk',
      '1 keeps coming but downgrades to an americano',
    ],
    drivers: ['price', 'habit'],
    net: '−2 customers on the final day vs day 1',
  },
  {
    headline: 'A card-only counter is invisible to most and a wall to a few',
    movements: [
      '1 older regular who pays cash switches to the bakery',
      '1 tourist walks in, sees the sign, walks out',
      'everyone else taps and never notices the change',
    ],
    drivers: ['payment', 'convenience'],
    net: '−2 customers on the final day vs day 1',
  },
  {
    headline: 'Opening on Sunday gathers the neighbourhood, not the commuters',
    movements: [
      '3 nearby residents who never come on weekdays make Sunday a routine',
      '0 weekday regulars change their week',
      'the Sunday market stall loses 1 of its regulars to your table outside',
    ],
    drivers: ['opening hours', 'routine'],
    net: '+3 customers on the final day vs day 1',
  },
  {
    headline: 'Lunch sandwiches make you a second stop, not a first',
    movements: [
      '2 office workers add a noon visit on top of their morning coffee',
      '1 customer who used to buy lunch at the deli next door now buys yours',
      'the deli owner stops coming for his afternoon espresso',
    ],
    drivers: ['product range', 'convenience'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Removing the sofa clears the loiterers and the mothers',
    movements: [
      '3 laptop campers move to the co-working café',
      '2 parents who met there after the school run go to the park kiosk instead',
      'turnover per seat rises, but the room feels empty at 3pm',
    ],
    drivers: ['seating', 'social habit'],
    net: '−4 customers on the final day vs day 1',
  },
  {
    headline: 'A student discount fills the quiet hours with people who tell each other',
    movements: [
      '2 students come the first day; 5 by the end of the week through word of mouth',
      '1 full-price regular feels the place got louder and comes earlier',
      'Starbucks’ afternoon student crowd thins slightly',
    ],
    drivers: ['price', 'word of mouth'],
    net: '+5 customers on the final day vs day 1',
  },
  {
    headline: 'A bigger cup size moves spend, not people',
    movements: [
      '3 regulars upsize and buy the same number of coffees',
      '0 new customers arrive — nobody switches shops for a larger cup',
      '1 customer who used to buy two smalls now buys one large',
    ],
    drivers: ['product range', 'habit'],
    net: '0 customers on the final day vs day 1',
  },
  {
    headline: 'Roadworks outside redraw the whole morning route',
    movements: [
      '3 regulars who walked past on their way to the station now pass the other side',
      '2 find you again once the detour becomes routine',
      '1 new customer discovers you because the detour goes past your door',
    ],
    drivers: ['distance', 'routine'],
    net: '0 customers on the final day vs day 1',
  },
  {
    headline: 'Cold brew on tap wins the summer afternoon from the bubble-tea shop',
    movements: [
      '3 teenagers who queued for bubble tea try the cold brew on the first hot day',
      '2 keep coming while the heat lasts',
      'morning traffic is untouched',
    ],
    drivers: ['product range', 'weather'],
    net: '+2 customers on the final day vs day 1',
  },
  {
    headline: 'Rude service loses more than a bad coffee ever did',
    movements: [
      '1 regular is snapped at and never returns; 2 friends follow her',
      'nobody complains to you — they just describe it to each other',
      'the espresso quality was unchanged all week',
    ],
    drivers: ['staff', 'word of mouth'],
    net: '−3 customers on the final day vs day 1',
  },
  {
    headline: 'A dog-friendly sign brings the morning walkers',
    movements: [
      '2 dog owners who used the park kiosk switch to your outside table',
      '1 customer with allergies moves to the window seat and stays',
      'the kiosk loses its 8am cluster',
    ],
    drivers: ['amenities', 'routine'],
    net: '+2 customers on the final day vs day 1',
  },
  {
    headline: 'Bundle pricing changes what people buy, not where',
    movements: [
      '4 regulars who bought coffee alone add the discounted croissant',
      '0 customers switch shops for the bundle',
      'the bakery two doors down sells 4 fewer croissants',
    ],
    drivers: ['price', 'product range'],
    net: '0 customers on the final day vs day 1',
  },
  {
    headline: 'A pop-up next door borrows your queue for a week',
    movements: [
      '3 regulars try the pop-up out of curiosity on day 2',
      'all 3 are back by day 5 — the pop-up has no seats and no loyalty card',
      '1 pop-up customer discovers you and stays after it leaves',
    ],
    drivers: ['novelty', 'seating'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Cutting the decaf drops the evening regulars',
    movements: [
      '2 late-afternoon customers who only drank decaf move to the hotel bar',
      '1 switches to tea and stays',
      'morning trade never notices the shorter menu',
    ],
    drivers: ['product range', 'routine'],
    net: '−2 customers on the final day vs day 1',
  },
  {
    headline: 'Live music on Friday brings a crowd that is not coming for coffee',
    movements: [
      '6 new faces arrive on Friday night and buy one drink each',
      '2 regulars skip Friday because it is loud',
      'none of the Friday crowd shows up on Monday',
    ],
    drivers: ['events', 'novelty'],
    net: '+4 customers on the final day vs day 1',
  },
  {
    headline: 'A takeaway window shifts the rush without adding anyone',
    movements: [
      '3 regulars stop coming inside and use the window',
      'the room feels quieter, so 1 laptop worker stays longer',
      'no competitor customers move — they did not know the window opened',
    ],
    drivers: ['convenience', 'awareness'],
    net: '0 customers on the final day vs day 1',
  },
  {
    headline: 'A competitor’s two-for-one draws the group, not the individual',
    movements: [
      '2 pairs of colleagues who used to split between you and Starbucks now go together for the deal',
      '1 solo regular stays — the offer does nothing for one cup',
      'the pairs come back the day the promotion ends',
    ],
    drivers: ['price', 'social habit'],
    net: '−4 customers on the final day vs day 1',
  },
  {
    headline: 'Better beans are noticed by the few who care and pay for them',
    movements: [
      '1 espresso purist switches from the roastery across town',
      '2 regulars say it tastes different and keep ordering anyway',
      '1 milk-drink regular tastes nothing new and never hears about it',
    ],
    drivers: ['quality', 'habit'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Reusable-cup discount nudges the already-loyal',
    movements: [
      '3 regulars start bringing cups and visit no more or less often',
      '1 new customer from the eco shop next door is persuaded',
      'takeaway waste falls; footfall barely moves',
    ],
    drivers: ['rewards', 'values'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'A queue visible from the street attracts and repels at once',
    movements: [
      '2 passers-by join because a queue looks like quality',
      '1 regular in a hurry crosses to the kiosk',
      'the effect vanishes when the queue clears at 9:15',
    ],
    drivers: ['wait time', 'reputation'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'Breakfast bowls bring the gym crowd for two weeks',
    movements: [
      '3 people from the 7am class come straight over, damp hair and all',
      '1 stays once the novelty fades; 2 go back to their shake',
      'your regular pastry buyers ignore the bowls entirely',
    ],
    drivers: ['product range', 'novelty'],
    net: '+1 customer on the final day vs day 1',
  },
  {
    headline: 'A bigger sign fixes the problem nobody reported',
    movements: [
      '2 office workers who walked past for months notice you exist',
      '1 tourist a day wanders in instead of into the chain',
      'nobody who already knew you changes anything',
    ],
    drivers: ['awareness', 'distance'],
    net: '+3 customers on the final day vs day 1',
  },
  {
    headline: 'Losing the outside tables to a permit loses the smokers and the sun',
    movements: [
      '2 smokers move to the bar with a terrace',
      '1 sunny-morning regular comes in on grey days only',
      'inside seats fill up, and 1 laptop worker gives up finding one',
    ],
    drivers: ['seating', 'weather'],
    net: '−3 customers on the final day vs day 1',
  },
]

const SEEN_KEY = 'simffee.seenSketches'

const seen = (): number[] => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < MOCK_ANSWERS.length) : []
  } catch {
    return []
  }
}

/** A random sketch that has not been shown yet this browser session; once every sketch has
 *  been used the pool starts over. */
export const randomMock = (): MockAnswer => {
  let used = seen()
  if (used.length >= MOCK_ANSWERS.length) used = []
  const pool = MOCK_ANSWERS.map((_, i) => i).filter((i) => !used.includes(i))
  const pick = pool[Math.floor(Math.random() * pool.length)]
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...used, pick]))
  } catch {
    // storage unavailable: still return a sketch, just without memory
  }
  return MOCK_ANSWERS[pick]
}
