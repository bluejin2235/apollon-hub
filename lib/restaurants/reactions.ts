export const RESTAURANT_REACTION_EMOJIS = ["👍", "🔥", "😋", "💰", "🏆"] as const;
export const REVIEW_REACTION_EMOJIS = ["👍", "❤️", "😂", "😮"] as const;

export type RestaurantReactionRow = {
  id: string;
  restaurant_id: string;
  profile_id: string;
  emoji: string;
};

export type ReviewReactionRow = {
  id: string;
  review_id: string;
  profile_id: string;
  emoji: string;
};

export function isRestaurantReactionEmoji(value: string): value is (typeof RESTAURANT_REACTION_EMOJIS)[number] {
  return (RESTAURANT_REACTION_EMOJIS as readonly string[]).includes(value);
}

export function isReviewReactionEmoji(value: string): value is (typeof REVIEW_REACTION_EMOJIS)[number] {
  return (REVIEW_REACTION_EMOJIS as readonly string[]).includes(value);
}
