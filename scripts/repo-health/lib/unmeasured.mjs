// Thrown by a measurement that knows why it has no value. The reason is a fixed
// phrase chosen by the tool, because the report publishes it; the raw error of an
// unexpected failure goes to the log instead. Kept in its own module so the signal
// modules and the registry that lists them do not import each other.
export class Unmeasured extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'Unmeasured'
    this.reason = reason
  }
}
