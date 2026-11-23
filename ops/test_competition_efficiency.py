import copy
import unittest
from build_competition_efficiency import normalize, standardize, overlapping_launch_models, recent_two_month_window
import datetime as dt

class StandardizationTests(unittest.TestCase):
    def test_recent_two_month_window_uses_calendar_months_and_inclusive_end(self):
        self.assertEqual(recent_two_month_window(dt.date(2026,11,12)),('2026-09-13','2026-11-12'))
        self.assertEqual(recent_two_month_window(dt.date(2026,3,31)),('2026-02-01','2026-03-31'))
    def test_launch_exclusion_is_limited_to_intersecting_regular_periods(self):
        activities=[{'batchId':'launch','start':'2026-11-10','end':'2026-11-12','models':['phone']}]
        self.assertEqual(overlapping_launch_models(activities,'2026-11-06','2026-11-09'),(set(),[]))
        self.assertEqual(overlapping_launch_models(activities,'2026-11-10','2026-11-12'),({'phone'},['launch']))
        self.assertEqual(overlapping_launch_models(activities,'2026-11-12','2026-11-15'),({'phone'},['launch']))
        self.assertEqual(overlapping_launch_models(activities,'2026-11-13','2026-11-16'),(set(),[]))
    def test_actual_period_quotes_determine_weights_and_preserve_pp_units(self):
        low = ('BD', 'JD', 'tradeIn', 'low'); high = ('BD', 'JD', 'tradeIn', 'high')
        periods = [
            {'cells': {low: {'competition': [90, 54], 'control': [10, 4]}, high: {'competition': [10, 3], 'control': [90, 27]}}},
            {'cells': {low: {'competition': [10, 6], 'control': [90, 36]}, high: {'competition': [90, 27], 'control': [10, 3]}}},
        ]
        standardize(periods)
        self.assertAlmostEqual(next(s['weight'] for s in periods[0]['strata'] if s['band']=='low'), .9)
        self.assertAlmostEqual(next(s['weight'] for s in periods[1]['strata'] if s['band']=='low'), .1)
        self.assertAlmostEqual(periods[0]['difference'], 18)
        self.assertAlmostEqual(periods[1]['difference'], 2)
        for p in periods: self.assertAlmostEqual(p['comparisonCoverage'], 100)

    def test_missing_control_stratum_is_excluded_without_filling_zero(self):
        h1 = ('a', 'b', 'c', 'one'); h2 = ('a', 'b', 'c', 'two')
        periods = [{'cells': {h1: {'competition': [20, 10], 'control': [20, 8]}, h2: {'competition': [80, 20], 'control': [0, 0]}}}]
        weights = standardize(periods)
        self.assertEqual(len(weights), 1)
        self.assertAlmostEqual(periods[0]['comparisonCoverage'], 20)
        self.assertAlmostEqual(periods[0]['difference'], 10)

    def test_each_period_uses_its_own_supported_strata_without_global_intersection(self):
        periods = [
            {'cells': {('a','b','c','low'): {'competition':[10,6], 'control':[10,4]}}},
            {'cells': {('a','b','c','high'): {'competition':[20,8], 'control':[20,6]}}},
        ]
        standardize(periods)
        self.assertAlmostEqual(periods[0]['difference'],20)
        self.assertAlmostEqual(periods[1]['difference'],10)
        self.assertEqual([len(p['strata']) for p in periods],[1,1])

    def test_no_common_support_is_unavailable(self):
        periods = [{'cells': {('a', 'b', 'c', 'one'): {'competition': [10, 5], 'control': [0, 0]}}}]
        self.assertEqual(standardize(periods), set())
        self.assertIsNone(periods[0]['difference'])

    def test_model_normalization_does_not_fuzzy_merge_different_variants(self):
        self.assertEqual(normalize(' iPhone １２ '), normalize('iPhone12'))
        self.assertNotEqual(normalize('iPhone12'), normalize('iPhone12 Pro'))

if __name__ == '__main__':
    unittest.main()
