import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  return (
    <footer className={styles.footer}>
      Made by <span className={styles.name}>Raunak Varma</span>
    </footer>
  );
}
