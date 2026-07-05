'use client';

import React from 'react';
import SpaceScene from './SpaceScene';

/**
 * Full, non-interactive 3D universe used as a fixed page backdrop.
 * Renders the complete SpaceScene (all particles, galaxies, nebulae, objects)
 * with pointer events disabled and no black-hole portal click handler.
 * The prefers-reduced-motion guard lives inside SpaceScene.
 */
const CosmicBackdrop: React.FC = () => {
  return <SpaceScene interactive={false} zIndex={0} />;
};

export default CosmicBackdrop;
