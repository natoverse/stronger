export type {
	AppSettings,
	AppBooleanSettingKey,
	AppNumericSettingKey,
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
	FoodItem,
	PreviousSetData,
	ProgressionProposal,
	ScheduleEntry,
	SetResult,
	SetTemplate,
	SetType,
	WeightBasis,
	WithingsMeasurement,
	GarminWellnessEntry,
	Workout,
	WorkoutScheduleEntry,
} from './types.js';

export { FLAG_SENTINEL } from './types.js';

export {
	computeExercise,
	computeSet,
	computeSetWeight,
	computeWeight,
	roundToEasyPlateMath,
	roundToNearest,
} from './compute.js';

export {
	computeProgression,
	isCrossReferenceOnly,
} from './progression.js';
