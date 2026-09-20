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
]

export const randomMock = (): MockAnswer => MOCK_ANSWERS[Math.floor(Math.random() * MOCK_ANSWERS.length)]
