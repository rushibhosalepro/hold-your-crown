import { reddit } from '@devvit/web/server';

export const createPost = async () => {
  return await reddit.submitCustomPost({
    title: '👑 Hold Your Crown — grab the crown, hold it longest to win!',
  });
};
