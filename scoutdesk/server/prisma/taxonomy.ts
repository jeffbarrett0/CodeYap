/**
 * Default football taxonomy. Hotkeys are single keys (letters/digits) or
 * `shift+<key>`. Reserved by the player and never assigned here:
 *   space ← → [ ] f m d i o ? / # delete backspace enter escape
 */
export interface DefaultTag {
  name: string
  hotkey: string
  outcome?: 'success' | 'fail' | 'neutral'
}
export interface DefaultCategory {
  name: string
  color: string
  tags: DefaultTag[]
}

export const DEFAULT_TAXONOMY: DefaultCategory[] = [
  {
    name: 'Attacking',
    color: '#f43f5e',
    tags: [
      { name: 'Shot', hotkey: 's' },
      { name: 'Shot on target', hotkey: 't', outcome: 'success' },
      { name: 'Goal', hotkey: 'g', outcome: 'success' },
      { name: 'Key pass', hotkey: 'k', outcome: 'success' },
      { name: 'Cross', hotkey: 'c' },
      { name: 'Dribble', hotkey: 'r' },
      { name: 'Run in behind', hotkey: 'b' },
      { name: 'Combination play', hotkey: 'y', outcome: 'success' },
    ],
  },
  {
    name: 'Defending',
    color: '#38bdf8',
    tags: [
      { name: 'Tackle', hotkey: 'a' },
      { name: 'Interception', hotkey: 'e', outcome: 'success' },
      { name: 'Duel won', hotkey: '1', outcome: 'success' },
      { name: 'Duel lost', hotkey: '2', outcome: 'fail' },
      { name: 'Pressing action', hotkey: 'p' },
      { name: 'Aerial duel', hotkey: 'h' },
      { name: 'Block', hotkey: 'v', outcome: 'success' },
    ],
  },
  {
    name: 'Transitions',
    color: '#a78bfa',
    tags: [
      { name: 'Counter-attack', hotkey: 'u' },
      { name: 'Turnover', hotkey: 'q' },
      { name: 'Recovery', hotkey: 'j', outcome: 'success' },
    ],
  },
  {
    name: 'Set pieces',
    color: '#fbbf24',
    tags: [
      { name: 'Corner', hotkey: '4' },
      { name: 'Free kick', hotkey: '5' },
      { name: 'Throw-in', hotkey: '6' },
      { name: 'Penalty', hotkey: '7' },
    ],
  },
  {
    name: 'Goalkeeper',
    color: '#2dd4bf',
    tags: [
      { name: 'Save', hotkey: 'l', outcome: 'success' },
      { name: 'Claim', hotkey: '8', outcome: 'success' },
      { name: 'Distribution', hotkey: '9' },
    ],
  },
  {
    name: 'Negative events',
    color: '#fb923c',
    tags: [
      { name: 'Error', hotkey: 'z', outcome: 'fail' },
      { name: 'Lost possession', hotkey: '3', outcome: 'fail' },
      { name: 'Foul', hotkey: 'shift+x', outcome: 'fail' },
      { name: 'Card', hotkey: 'shift+c', outcome: 'fail' },
    ],
  },
]
