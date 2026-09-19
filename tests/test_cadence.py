from pedalquest.sensor import CadenceCalculator


class FakeCrank:
    """실제 센서처럼 1초마다 (누적 회전수, 마지막 크랭크 이벤트 시각)을 알린다."""

    def __init__(self, calc, revs=0, evt=0):
        self.calc = calc
        self.revs = revs
        self.evt = evt
        self.now = 0.0
        self.next_rev = None

    def ride(self, rpm, seconds):
        out = []
        for _ in range(seconds):
            self.now += 1
            if rpm:
                period = 60 / rpm
                if self.next_rev is None:
                    self.next_rev = self.now - 1 + period
                while self.next_rev <= self.now:
                    self.revs = (self.revs + 1) % 65536
                    self.evt = int(self.next_rev * 1024) % 65536
                    self.next_rev += period
            else:
                self.next_rev = None
            self.calc.feed(self.revs, self.evt, self.now)
            out.append(round(self.calc.get_rpm(self.now)))
        return out


def test_steady_rpm_with_16bit_overflow():
    c = CadenceCalculator()
    crank = FakeCrank(c, revs=65530, evt=65000)
    out = crank.ride(80, 20)
    assert crank.revs < 65530  # 실제로 오버플로우가 일어났는지
    assert all(r == 80 for r in out[2:])


def test_stop_goes_to_zero_within_4_seconds():
    c = CadenceCalculator()
    crank = FakeCrank(c)
    crank.ride(80, 10)
    out = crank.ride(0, 5)
    assert out[3] == 0 and out[4] == 0


def test_long_rest_then_restart_has_no_spike():
    c = CadenceCalculator()
    crank = FakeCrank(c)
    crank.ride(80, 10)
    crank.ride(0, 70)
    out = crank.ride(90, 6)
    assert max(out) <= 91
    assert out[-1] == 90


def test_rpm_change():
    c = CadenceCalculator()
    crank = FakeCrank(c)
    crank.ride(80, 5)
    assert crank.ride(60, 5)[-1] == 60


def test_slow_cadence_not_reported_as_stopped():
    c = CadenceCalculator()
    crank = FakeCrank(c)
    out = crank.ride(30, 12)
    assert all(r == 30 for r in out[4:])


def test_duplicate_notifications_ignored():
    c = CadenceCalculator()
    c.feed(10, 1024, now=0)
    c.feed(11, 2048, now=1)
    assert round(c.get_rpm(now=1)) == 60
    c.feed(11, 2048, now=1.5)
    assert round(c.get_rpm(now=1.5)) == 60


def test_none_data_ignored():
    c = CadenceCalculator()
    c.feed(None, None, now=0)
    assert c.get_rpm(now=0) == 0
