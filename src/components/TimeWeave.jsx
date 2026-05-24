import React from 'react';
import Link from '@docusaurus/Link';
import useContentItems from '../hooks/useContentItems';
import styles from './TimeWeave.module.css';

export default function TimeWeave() {
  const items = useContentItems();

  if (items.length === 0) {
    return <p className={styles.empty}>No timeline items yet.</p>;
  }

  return (
    <div className={styles.timeline}>
      {items.map((item) => (
        <article className={styles.item} key={item.id}>
          <p className={styles.date}>{item.date}</p>
          <h2 className={styles.title}>
            <Link to={item.href}>{item.title}</Link>
          </h2>
          {item.description ? <p className={styles.description}>{item.description}</p> : null}
        </article>
      ))}
    </div>
  );
}
