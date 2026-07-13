export type {
	AppSettings,
	AppBooleanSettingKey,
	AppPercentSettingKey,
	CardioActivity,
	ComputedExercise,
	ComputedSet,
	DayFlagEntry,
	DayFlags,
	ExerciseRole,
	ExerciseTemplate,
	GearType,
	LiftConfig,
	MealCategory,
	MealItem,
	MealLogEntry,
	PreviousSetData,
	ProgressionProposal,
	ScheduleEntry,
	SetResult,
	SetTemplate,
	SetType,
	WeightBasis,
	WithingsMeasurement,
	Workout,
	WorkoutScheduleEntry,
} from './types.js';

export { FLAG_SENTINEL } from './types.js';

export {
	computeExercise,
	computeSet,
	computeSetWeight,
	computeWeight,
	roundToNearest,
} from './compute.js';

export {
	computeProgression,
	isCrossReferenceOnly,
} from './progression.js';
