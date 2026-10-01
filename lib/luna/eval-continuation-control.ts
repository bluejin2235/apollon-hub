export class EvalReviewPaused extends Error {
  constructor(message = 'Document review checkpoint saved; continuation required') {
    super(message);
    this.name = 'EvalReviewPaused';
  }
}
