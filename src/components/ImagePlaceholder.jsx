import React from 'react';

export default function ImagePlaceholder({
  align = 'center',
  wrap = null,
  caption = 'Image Placeholder',
  width = null,
  height = '220px',
}) {
  const classes = ['image-placeholder', `image-placeholder--${align}`];
  if (wrap === 'right') classes.push('image-placeholder--wrap-right');
  if (wrap === 'left') classes.push('image-placeholder--wrap-left');

  const style = {
    height,
  };

  if (width) {
    style.width = width;
  }

  return (
    <figure className={classes.join(' ')}>
      <div className="image-placeholder__frame" style={style}>
        {caption}
      </div>
    </figure>
  );
}
