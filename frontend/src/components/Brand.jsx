import React from 'react';

export const Brand = ({ variant = 'black', stacked = false, id = 'brand' }) => <div className={`brand alta-brand ${stacked ? 'stacked' : ''}`} data-testid={id}>
  <img data-testid={`${id}-logo`} src={`/brand/alta-pulse-${stacked ? 'stacked-' : ''}${variant}.png`} alt="Alta Pulse" width={stacked ? 980 : 1060} height={stacked ? 1420 : 390}/>
</div>;

export const BrandMark = ({ variant = 'red', id = 'brand-mark' }) => <img className="alta-mark" data-testid={id} src={`/brand/alta-mark-${variant}.png`} alt="" aria-hidden="true" width="732" height="668"/>;