import type { Tool } from '../model/types';
import type { IconName } from './icons';

/** Drawing tools: toolbar order, shortcut key and status-bar hint. */
export const TOOLS: { id: Tool; label: string; icon: IconName; key: string; hint: string }[] = [
  { id: 'select', label: 'Select & move', icon: 'select', key: 'V', hint: 'Click to select · drag to move · drag empty space to pan · double-click a room to walk there' },
  { id: 'wall', label: 'Draw walls', icon: 'wall', key: 'W', hint: 'Click to start, click to add corners · double-click, Enter or right-click to finish · Esc cancels' },
  { id: 'door', label: 'Place door', icon: 'door', key: 'D', hint: 'Click on a wall to place a door' },
  { id: 'window', label: 'Place window', icon: 'window', key: 'N', hint: 'Click on a wall to place a window' },
  { id: 'room', label: 'Detect room', icon: 'room', key: 'R', hint: 'Click inside an area enclosed by walls to create a room' },
  { id: 'stair', label: 'Place stairs', icon: 'stairs', key: 'S', hint: 'Click to place stairs leading up to the next level' },
  { id: 'measure', label: 'Measure', icon: 'ruler', key: 'M', hint: 'Drag to measure a distance · snaps to wall corners' },
];
