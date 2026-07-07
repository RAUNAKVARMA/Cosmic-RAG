export type NebulaId = 'image-studio' | 'coding-assistant';

export interface NebulaHoverState {
  id: NebulaId;
  x: number;
  y: number;
  visible: boolean;
}
