// @flow strict
import React from 'react';
import styles from './Content.module.scss';

type Props = {
  author?: string,
  body: string,
  title: string
};

const Content = ({ author, body, title }: Props) => (
  <div className={styles['content']}>
    <h1 className={styles['content__title']}>{title}</h1>
    {author !== undefined && (
      <h3 className={styles['content__author']}>{`by ${author}`}</h3>
    )}
    <div
      className={styles['content__body']}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  </div>
);

export default Content;
